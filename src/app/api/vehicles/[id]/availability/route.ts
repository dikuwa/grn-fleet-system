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
import { vehicles, vehicleDefects, maintenanceEvents } from '@/db/schema/fleet';
import { vehicleAllocations } from '@/db/schema/trips';
import { eq, and, ne, gte, lte, isNull, lt, gt } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

interface Blocker {
  type: 'overlapping_allocation' | 'critical_defect' | 'maintenance_block' | 'vehicle_status';
  detail: string;
  severity: 'error' | 'warning';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const startParam = searchParams.get('start');
    const endParam = searchParams.get('end');

    const db = getDb();

    // 1. Fetch the vehicle
    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ available: false, blockers: [{ type: 'vehicle_status', detail: 'Vehicle not found', severity: 'error' }] });
    }

    const blockers: Blocker[] = [];

    // 2. Check vehicle status
    const availableStatuses = ['available', 'provisional'];
    if (!availableStatuses.includes(vehicle.status)) {
      blockers.push({
        type: 'vehicle_status',
        detail: `Vehicle is currently "${vehicle.status}". Only available or provisional vehicles can be allocated.`,
        severity: 'error',
      });
    }

    // 3. Check for critical unresolved defects
    const criticalDefects = await db
      .select()
      .from(vehicleDefects)
      .where(
        and(
          eq(vehicleDefects.vehicleId, id),
          eq(vehicleDefects.severity, 'critical'),
          isNull(vehicleDefects.resolvedAt),
        ),
      );

    if (criticalDefects.length > 0) {
      blockers.push({
        type: 'critical_defect',
        detail: `${criticalDefects.length} critical defect${criticalDefects.length > 1 ? 's' : ''} unresolved: ${criticalDefects.map((d) => d.description).join('; ')}`,
        severity: 'error',
      });
    }

    // Also check major defects (warning level)
    const majorDefects = await db
      .select()
      .from(vehicleDefects)
      .where(
        and(
          eq(vehicleDefects.vehicleId, id),
          eq(vehicleDefects.severity, 'major'),
          isNull(vehicleDefects.resolvedAt),
        ),
      );

    if (majorDefects.length > 0) {
      blockers.push({
        type: 'critical_defect',
        detail: `${majorDefects.length} major defect${majorDefects.length > 1 ? 's' : ''} unresolved (restricted use)`,
        severity: 'warning',
      });
    }

    // 4. Check overlapping allocations (if period is specified)
    if (startParam) {
      const startDate = new Date(startParam);
      const endDate = endParam ? new Date(endParam) : new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      // An allocation overlaps if: start < requested_end AND end > requested_start
      // AND state is not cancelled
      const overlappingAllocations = await db
        .select()
        .from(vehicleAllocations)
        .where(
          and(
            eq(vehicleAllocations.vehicleId, id),
            lt(vehicleAllocations.startAt, endDate),
            gt(vehicleAllocations.endAt, startDate),
            ne(vehicleAllocations.state, 'cancelled')
          ),
        );

      if (overlappingAllocations.length > 0) {
        const alloc = overlappingAllocations[0];
        blockers.push({
          type: 'overlapping_allocation',
          detail: `Overlapping allocation exists: ${alloc.startAt.toLocaleDateString()} – ${alloc.endAt.toLocaleDateString()} (state: ${alloc.state})`,
          severity: 'error',
        });
      }
    }

    // 5. Check for scheduled maintenance blocking the period
    if (startParam) {
      const startDate = new Date(startParam);
      const blockWindow = new Date(startDate.getTime() - 7 * 24 * 60 * 60 * 1000); // 1 week before

      // Maintenance events where nextServiceDate falls within our window
      const upcomingMaintenance = await db
        .select()
        .from(maintenanceEvents)
        .where(
          and(
            eq(maintenanceEvents.vehicleId, id),
            // Maintenance scheduled in the window that could be a blocker
            gte(maintenanceEvents.serviceDate, blockWindow.toISOString().split('T')[0] as any),
          ),
        )
        .orderBy(maintenanceEvents.serviceDate)
        .limit(5);

      // Check if any maintenance has a nextServiceDate that overlaps
      const blockingMaintenance = upcomingMaintenance.filter(
        (m) => m.nextServiceDate && new Date(m.nextServiceDate) >= startDate,
      );

      if (blockingMaintenance.length > 0) {
        for (const m of blockingMaintenance) {
          blockers.push({
            type: 'maintenance_block',
            detail: `Scheduled maintenance due ${m.nextServiceDate}${m.description ? `: ${m.description}` : ''}`,
            severity: 'warning',
          });
        }
      }
    }

    // 6. Check licence expiry
    if (vehicle.licenceExpiryDate && new Date(vehicle.licenceExpiryDate) < new Date()) {
      blockers.push({
        type: 'vehicle_status',
        detail: `Vehicle licence expired on ${vehicle.licenceExpiryDate}`,
        severity: 'error',
      });
    }

    // 7. Check roadworthy test expiry
    if (vehicle.roadworthyTestDate && new Date(vehicle.roadworthyTestDate) < new Date()) {
      blockers.push({
        type: 'vehicle_status',
        detail: `Roadworthy test expired on ${vehicle.roadworthyTestDate}`,
        severity: 'error',
      });
    }

    const available = blockers.filter((b) => b.severity === 'error').length === 0;
    const hasWarnings = blockers.filter((b) => b.severity === 'warning').length > 0;

    return NextResponse.json({
      available,
      hasWarnings,
      vehicleId: id,
      vehicleStatus: vehicle.status,
      currentOdometer: vehicle.currentOdometer,
      blockers,
      checkPeriod: startParam
        ? { start: startParam, end: endParam || null }
        : null,
    });
  } catch (error) {
    console.error('[Availability] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to check availability' },
      { status: 500 },
    );
  }
}
