/**
 * Vehicle Availability API
 *
 * GET /api/vehicles/[id]/availability?start=2026-07-21&end=2026-07-25
 *
 * Checks whether a vehicle is eligible for allocation/use during a given
 * period. Returns availability status plus a list of any blockers found.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  maintenanceEvents,
  vehicleDefects,
  vehicleDocuments,
  vehicles,
} from '@/db/schema/fleet';
import { vehicleAllocations } from '@/db/schema/trips';
import { and, desc, eq, gt, isNotNull, isNull, lt, ne, sql } from 'drizzle-orm';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { vehicleScopeCondition } from '@/lib/record-scope';

interface Blocker {
  type: 'overlapping_allocation' | 'critical_defect' | 'maintenance_block' | 'vehicle_status';
  detail: string;
  severity: 'error' | 'warning';
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addUtcDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/fleet', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get('start');
    const endParam = searchParams.get('end');

    if (startParam && !isDateOnly(startParam)) {
      return NextResponse.json({ error: 'Start date must use YYYY-MM-DD' }, { status: 400 });
    }
    if (endParam && !isDateOnly(endParam)) {
      return NextResponse.json({ error: 'End date must use YYYY-MM-DD' }, { status: 400 });
    }
    if (endParam && !startParam) {
      return NextResponse.json({ error: 'A start date is required when an end date is provided' }, { status: 400 });
    }
    if (startParam && endParam && endParam < startParam) {
      return NextResponse.json({ error: 'End date cannot be before the start date' }, { status: 400 });
    }
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json(
        {
          available: false,
          blockers: [
            { type: 'vehicle_status', detail: 'Vehicle not found', severity: 'error' },
          ],
        },
        { status: 404 },
      );
    }

    const db = getDb();
    const roleNames = await getSessionRoleNames(session);
    const fleetAccess = resolveDashboardAccess('/dashboard/fleet', roleNames);

    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(
        and(
          eq(vehicles.id, id),
          vehicleScopeCondition({
            tenantId: session.tenantId,
            userId: session.user.id,
            recordScope: fleetAccess.recordScope ?? 'related',
          }),
        ),
      )
      .limit(1);

    if (!vehicle) {
      return NextResponse.json(
        {
          available: false,
          blockers: [
            { type: 'vehicle_status', detail: 'Vehicle not found', severity: 'error' },
          ],
        },
        { status: 404 },
      );
    }

    const blockers: Blocker[] = [];

    // Fresh allocation creation requires exactly the canonical "available"
    // status in both /api/allocations and the database concurrency guard. Do
    // not advertise provisional vehicles as allocatable here and then fail the
    // actual reservation with a 409.
    if (vehicle.status !== 'available') {
      blockers.push({
        type: 'vehicle_status',
        detail: `Vehicle is currently "${vehicle.status}". Only available vehicles can be allocated.`,
        severity: 'error',
      });
    }

    const blockingDefects = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .where(
        and(
          eq(vehicleDefects.vehicleId, id),
          eq(vehicleDefects.isBlocking, true),
          isNull(vehicleDefects.resolvedAt),
        ),
      );

    if (blockingDefects.length > 0) {
      blockers.push({
        type: 'critical_defect',
        detail: `${blockingDefects.length} unresolved blocking defect${blockingDefects.length > 1 ? 's' : ''} prevent allocation.`,
        severity: 'error',
      });
    }

    const majorDefects = await db
      .select({ id: vehicleDefects.id })
      .from(vehicleDefects)
      .where(
        and(
          eq(vehicleDefects.vehicleId, id),
          eq(vehicleDefects.severity, 'major'),
          eq(vehicleDefects.isBlocking, false),
          isNull(vehicleDefects.resolvedAt),
        ),
      );

    if (majorDefects.length > 0) {
      blockers.push({
        type: 'critical_defect',
        detail: `${majorDefects.length} unresolved major defect${majorDefects.length > 1 ? 's' : ''} require operational review.`,
        severity: 'warning',
      });
    }

    let requestedStartDate: Date | null = null;
    let requestedEndDate: Date | null = null;
    let requestedEndDateOnly: string | null = null;

    if (startParam) {
      requestedStartDate = new Date(`${startParam}T00:00:00Z`);
      requestedEndDateOnly = endParam ?? addUtcDays(startParam, 7);
      requestedEndDate = new Date(`${requestedEndDateOnly}T00:00:00Z`);

      const overlappingAllocations = await db
        .select({
          startAt: vehicleAllocations.startAt,
          endAt: vehicleAllocations.endAt,
          state: vehicleAllocations.state,
        })
        .from(vehicleAllocations)
        .where(
          and(
            eq(vehicleAllocations.vehicleId, id),
            lt(vehicleAllocations.startAt, requestedEndDate),
            gt(vehicleAllocations.endAt, requestedStartDate),
            ne(vehicleAllocations.state, 'cancelled'),
          ),
        );

      if (overlappingAllocations.length > 0) {
        const allocation = overlappingAllocations[0];
        blockers.push({
          type: 'overlapping_allocation',
          detail: `Overlapping allocation exists: ${allocation.startAt.toLocaleDateString()} – ${allocation.endAt.toLocaleDateString()} (state: ${allocation.state})`,
          severity: 'error',
        });
      }

      const [latestReminder] = await db
        .select({ nextServiceDate: maintenanceEvents.nextServiceDate })
        .from(maintenanceEvents)
        .where(
          and(
            eq(maintenanceEvents.vehicleId, id),
            isNotNull(maintenanceEvents.nextServiceDate),
          ),
        )
        .orderBy(desc(maintenanceEvents.serviceDate), desc(maintenanceEvents.createdAt))
        .limit(1);

      if (
        latestReminder?.nextServiceDate &&
        requestedEndDateOnly &&
        latestReminder.nextServiceDate <= requestedEndDateOnly
      ) {
        const overdue = latestReminder.nextServiceDate < startParam;
        blockers.push({
          type: 'maintenance_block',
          detail: `${overdue ? 'Next service reminder overdue since' : 'Next service reminder due'} ${latestReminder.nextServiceDate}.`,
          severity: 'warning',
        });
      }
    }

    // Compliance evidence must remain valid for the whole requested allocation
    // period, not merely at departure. When no period is supplied, preserve the
    // current-day compliance check.
    const complianceDate =
      requestedEndDateOnly ?? startParam ?? new Date().toISOString().slice(0, 10);

    if (vehicle.licenceExpiryDate && vehicle.licenceExpiryDate < complianceDate) {
      blockers.push({
        type: 'vehicle_status',
        detail: `Vehicle licence expires before the requested period ends (${vehicle.licenceExpiryDate}).`,
        severity: 'error',
      });
    }

    // Retained document history must not let an older certificate with a later
    // expiry override a newer verified roadworthy record. Match compliance-report
    // semantics by selecting the newest verified evidence by issue date when
    // present, otherwise by upload chronology. Do not require an expiry here;
    // the existing policy only evaluates expiry when the current record has one.
    const [roadworthyDocument] = await db
      .select({
        expiryDate: vehicleDocuments.expiryDate,
        issueDate: vehicleDocuments.issueDate,
        createdAt: vehicleDocuments.createdAt,
      })
      .from(vehicleDocuments)
      .where(
        and(
          eq(vehicleDocuments.vehicleId, id),
          eq(vehicleDocuments.documentType, 'roadworthy'),
          eq(vehicleDocuments.isVerified, true),
        ),
      )
      .orderBy(
        desc(
          sql`COALESCE(${vehicleDocuments.issueDate}::timestamptz, ${vehicleDocuments.createdAt})`,
        ),
        desc(vehicleDocuments.createdAt),
      )
      .limit(1);

    if (roadworthyDocument?.expiryDate && roadworthyDocument.expiryDate < complianceDate) {
      blockers.push({
        type: 'vehicle_status',
        detail: `Verified roadworthy document expires before the requested period ends (${roadworthyDocument.expiryDate}).`,
        severity: 'error',
      });
    }

    const available = blockers.every((blocker) => blocker.severity !== 'error');
    const hasWarnings = blockers.some((blocker) => blocker.severity === 'warning');

    return NextResponse.json({
      available,
      hasWarnings,
      vehicleId: id,
      vehicleStatus: vehicle.status,
      currentOdometer: vehicle.currentOdometer,
      blockers,
      checkPeriod: startParam
        ? { start: startParam, end: requestedEndDateOnly }
        : null,
    });
  } catch (error) {
    console.error('[Availability] Failed:', error);
    return NextResponse.json({ error: 'Failed to check availability' }, { status: 500 });
  }
}
