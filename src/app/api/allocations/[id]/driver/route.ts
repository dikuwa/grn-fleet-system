/**
 * Allocation Driver Assignment API
 *
 * PATCH /api/allocations/[id]/driver  — Assign/replace a driver
 * DELETE /api/allocations/[id]/driver — Unassign the driver before issue
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import {
  employees,
  driverProfiles,
  driverLicences,
  driverLicenceCodes,
  driverProfessionalAuthorisations,
} from '@/db/schema/people';
import { eq, and, gt, lt, inArray, ne, sql, desc } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';
import { recordAuditEvent } from '@/lib/audit-event';
import { requestDrivers, transportRequests } from '@/db/schema/requests';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { createScopedNotifications } from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';
import { requestPostAuthorisationDriverReplacement } from '@/lib/driver-authority-replacement';

const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/allocations', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { driverEmployeeId, reason } = body;
    if (!driverEmployeeId) {
      return NextResponse.json({ error: 'driverEmployeeId is required' }, { status: 400 });
    }

    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    const db = getDb();
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestId: vehicleAllocations.requestId,
        requestReference: transportRequests.reference,
        requiredLicenceClass: vehicles.requiredLicenceClass,
        professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
        tripId: trips.id,
        tripIssuedAt: trips.issuedAt,
        tripDriverAcknowledgedAt: trips.driverAcknowledgedAt,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .leftJoin(trips, and(eq(trips.allocationId, vehicleAllocations.id), eq(trips.tenantId, session.tenantId)))
      .where(and(
        eq(vehicleAllocations.id, id),
        eq(vehicles.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
      ))
      .limit(1);

    if (!allocation) return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    if (!LIVE_ALLOCATION_STATES.includes(allocation.state as typeof LIVE_ALLOCATION_STATES[number])) {
      return NextResponse.json({ error: 'Driver replacement is only allowed before physical issue/closure' }, { status: 409 });
    }
    if (allocation.tripIssuedAt || allocation.tripDriverAcknowledgedAt) {
      return NextResponse.json(
        {
          error:
            'The primary driver cannot be changed after driver acknowledgement or physical vehicle issue. Cancel the unissued trip and create a new authorised assignment, or use the formal in-trip handover process after departure.',
        },
        { status: 409 },
      );
    }
    if (allocation.driverEmployeeId === driverEmployeeId) {
      return NextResponse.json({ error: 'Selected driver is already assigned to this allocation' }, { status: 409 });
    }
    if (allocation.driverEmployeeId && !cleanReason) {
      return NextResponse.json({ error: 'A reason is required when replacing an assigned driver' }, { status: 400 });
    }
    if (cleanReason.length > 500) {
      return NextResponse.json({ error: 'Driver replacement reason must be 500 characters or fewer' }, { status: 422 });
    }

    // Once final authorisation has produced a Trip Authority, a different
    // primary driver is a governance change rather than an ordinary allocation
    // edit. The helper creates a pending, versioned authority amendment and
    // deliberately leaves the live allocation/request driver untouched until
    // that amendment receives an authorised decision.
    const governedReplacement = await requestPostAuthorisationDriverReplacement({
      allocationId: id,
      driverEmployeeId,
      reason: cleanReason,
      session,
    });
    if (governedReplacement.handled) return governedReplacement.response;

    const [driver] = await db
      .select({
        id: employees.id,
        employeeStatus: employees.employmentStatus,
        employeeAvailability: employees.availabilityStatus,
        profileId: driverProfiles.id,
        driverStatus: driverProfiles.driverStatus,
        profileAvailability: driverProfiles.availabilityStatus,
        licenceId: driverLicences.id,
        licenceStatus: driverLicences.verificationStatus,
        licenceExpiry: driverLicences.expiryDate,
        licenceClass: driverLicences.licenceClass,
      })
      .from(employees)
      .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(and(
        eq(employees.id, driverEmployeeId),
        eq(employees.tenantId, session.tenantId),
        eq(employees.isDriver, true),
        eq(employees.employmentStatus, 'active'),
        eq(driverLicences.isActive, true),
      ))
      .orderBy(desc(driverLicences.version))
      .limit(1);

    if (!driver) return NextResponse.json({ error: 'Driver has no active licence profile.' }, { status: 409 });

    const [conflict] = await db.select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .where(and(
        eq(vehicleAllocations.driverEmployeeId, driverEmployeeId),
        ne(vehicleAllocations.id, id),
        inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
        lt(vehicleAllocations.startAt, allocation.endAt),
        gt(vehicleAllocations.endAt, allocation.startAt),
      ))
      .limit(1);
    if (conflict) return NextResponse.json({ error: 'Driver is already assigned during this period' }, { status: 409 });

    const [codes, professional] = await Promise.all([
      db.select({ code: driverLicenceCodes.code }).from(driverLicenceCodes)
        .where(and(eq(driverLicenceCodes.licenceId, driver.licenceId), eq(driverLicenceCodes.isActive, true))),
      db.select().from(driverProfessionalAuthorisations)
        .where(eq(driverProfessionalAuthorisations.driverProfileId, driver.profileId))
        .orderBy(desc(driverProfessionalAuthorisations.expiryDate)).limit(1),
    ]);
    const licenceCodes = [
      ...codes.map((row) => row.code),
      ...String(driver.licenceClass || '').split(',').map((code) => code.trim()).filter(Boolean),
    ];
    const compliance = calculateDriverCompliance({
      employeeStatus: driver.employeeStatus,
      availabilityStatus: driver.employeeAvailability !== 'available' ? driver.employeeAvailability : driver.profileAvailability,
      driverStatus: driver.driverStatus,
      licenceStatus: driver.licenceStatus,
      licenceExpiry: driver.licenceExpiry,
      licenceCodes: Array.from(new Set(licenceCodes)),
      requiredLicenceClass: allocation.requiredLicenceClass,
      professionalRequired: allocation.professionalAuthorisationRequired,
      professionalVerified: professional[0]?.isVerified,
      professionalExpiry: professional[0]?.expiryDate,
      tripEndAt: allocation.endAt,
      hasScheduleConflict: false,
    });
    if (!['eligible', 'eligible_expiring_soon'].includes(compliance.status)) {
      return NextResponse.json({
        error: 'Driver does not meet the compliance requirements for this vehicle and trip period.',
        compliance,
      }, { status: 409 });
    }

    const [existingRequestDriver] = await db.select({ id: requestDrivers.id })
      .from(requestDrivers)
      .where(and(eq(requestDrivers.requestId, allocation.requestId), eq(requestDrivers.employeeId, driverEmployeeId)))
      .limit(1);

    const now = new Date();
    const nowIso = now.toISOString();
    try {
      if (existingRequestDriver) {
        await db.execute(sql`
          WITH allocation_claim AS (
            UPDATE vehicle_allocations va
            SET driver_employee_id = ${driverEmployeeId}::uuid,
                version = va.version + 1,
                updated_at = ${nowIso}::timestamptz
            WHERE va.id = ${id}::uuid
              AND va.state IN ('provisional', 'confirmed')
              AND va.driver_employee_id IS NOT DISTINCT FROM ${allocation.driverEmployeeId}::uuid
              AND NOT EXISTS (
                SELECT 1 FROM trips t
                WHERE t.allocation_id = va.id
                  AND t.tenant_id = ${session.tenantId}::uuid
                  AND (t.issued_at IS NOT NULL OR t.driver_acknowledged_at IS NOT NULL)
              )
            RETURNING va.request_id
          ),
          request_updated AS (
            UPDATE transport_requests tr
            SET assigned_driver_employee_id = ${driverEmployeeId}::uuid, updated_at = ${nowIso}::timestamptz
            FROM allocation_claim ac
            WHERE tr.id = ac.request_id
              AND tr.tenant_id = ${session.tenantId}::uuid
              AND tr.assigned_driver_employee_id IS NOT DISTINCT FROM ${allocation.driverEmployeeId}::uuid
            RETURNING tr.id
          ),
          drivers_cleared AS (
            UPDATE request_drivers rd
            SET is_confirmed = false
            FROM request_updated ru
            WHERE rd.request_id = ru.id
              AND rd.id <> ${existingRequestDriver.id}::uuid
            RETURNING rd.id
          ),
          driver_confirmed AS (
            UPDATE request_drivers rd
            SET is_confirmed = true, licence_validated = true, driver_type = 'assigned'
            FROM request_updated ru
            WHERE rd.id = ${existingRequestDriver.id}::uuid
              AND rd.request_id = ru.id
              AND rd.employee_id = ${driverEmployeeId}::uuid
            RETURNING rd.id
          )
          SELECT CAST(CASE
            WHEN (SELECT count(*) FROM allocation_claim) = 1
             AND (SELECT count(*) FROM request_updated) = 1
             AND (SELECT count(*) FROM driver_confirmed) = 1
            THEN '1'
            ELSE 'atomic_driver_reassignment_failed_'
              || (SELECT count(*) FROM allocation_claim)::text
              || (SELECT count(*) FROM request_updated)::text
              || (SELECT count(*) FROM driver_confirmed)::text
          END AS integer) AS committed
        `);
      } else {
        await db.execute(sql`
          WITH allocation_claim AS (
            UPDATE vehicle_allocations va
            SET driver_employee_id = ${driverEmployeeId}::uuid,
                version = va.version + 1,
                updated_at = ${nowIso}::timestamptz
            WHERE va.id = ${id}::uuid
              AND va.state IN ('provisional', 'confirmed')
              AND va.driver_employee_id IS NOT DISTINCT FROM ${allocation.driverEmployeeId}::uuid
              AND NOT EXISTS (
                SELECT 1 FROM trips t
                WHERE t.allocation_id = va.id
                  AND t.tenant_id = ${session.tenantId}::uuid
                  AND (t.issued_at IS NOT NULL OR t.driver_acknowledged_at IS NOT NULL)
              )
            RETURNING va.request_id
          ),
          request_updated AS (
            UPDATE transport_requests tr
            SET assigned_driver_employee_id = ${driverEmployeeId}::uuid, updated_at = ${nowIso}::timestamptz
            FROM allocation_claim ac
            WHERE tr.id = ac.request_id
              AND tr.tenant_id = ${session.tenantId}::uuid
              AND tr.assigned_driver_employee_id IS NOT DISTINCT FROM ${allocation.driverEmployeeId}::uuid
            RETURNING tr.id
          ),
          drivers_cleared AS (
            UPDATE request_drivers rd
            SET is_confirmed = false
            FROM request_updated ru
            WHERE rd.request_id = ru.id
            RETURNING rd.id
          ),
          driver_inserted AS (
            INSERT INTO request_drivers (
              request_id, employee_id, driver_type, is_confirmed, licence_validated
            )
            SELECT ru.id, ${driverEmployeeId}::uuid, 'assigned', true, true
            FROM request_updated ru
            RETURNING id
          )
          SELECT CAST(CASE
            WHEN (SELECT count(*) FROM allocation_claim) = 1
             AND (SELECT count(*) FROM request_updated) = 1
             AND (SELECT count(*) FROM driver_inserted) = 1
            THEN '1'
            ELSE 'atomic_driver_reassignment_failed_'
              || (SELECT count(*) FROM allocation_claim)::text
              || (SELECT count(*) FROM request_updated)::text
              || (SELECT count(*) FROM driver_inserted)::text
          END AS integer) AS committed
        `);
      }
    } catch (mutationError) {
      if (String(mutationError).includes('atomic_driver_reassignment_failed')) {
        return NextResponse.json(
          { error: 'The trip or driver assignment changed while reassignment was being saved. Refresh and review the current state.' },
          { status: 409 },
        );
      }
      throw mutationError;
    }

    try {
      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: allocation.driverEmployeeId ? 'driver.replaced' : 'driver.assigned',
        entityType: 'allocation',
        entityId: id,
        summary: allocation.driverEmployeeId
          ? `Driver replaced: ${allocation.driverEmployeeId} → ${driverEmployeeId}. Reason: ${cleanReason}`
          : `Driver ${driverEmployeeId} assigned to allocation`,
        before: { driverEmployeeId: allocation.driverEmployeeId },
        after: { driverEmployeeId, compliance, replacementReason: cleanReason || null },
      });
      await recordTenantRequestActivity({
        tenantId: session.tenantId,
        requestId: allocation.requestId,
        reference: allocation.requestReference,
        stage: 'driver_assigned',
        officeLabel: 'Transport office',
      });
    } catch (activityError) {
      console.warn('[Allocation Driver] Post-commit audit/activity failed:', activityError);
    }

    try {
      const affectedDriverIds = [driverEmployeeId, allocation.driverEmployeeId].filter(Boolean) as string[];
      const affectedDrivers = affectedDriverIds.length > 0
        ? await db
            .select({ id: employees.id, userId: employees.userId, email: employees.email, firstName: employees.firstName })
            .from(employees)
            .where(and(inArray(employees.id, affectedDriverIds), eq(employees.tenantId, session.tenantId)))
        : [];
      const newDriver = affectedDrivers.find((row) => row.id === driverEmployeeId);
      const previousDriver = allocation.driverEmployeeId
        ? affectedDrivers.find((row) => row.id === allocation.driverEmployeeId)
        : undefined;

      if (newDriver?.userId) {
        await createScopedNotifications({
          tenantId: session.tenantId,
          recipientUserIds: [newDriver.userId],
          category: 'action_required',
          eventType: allocation.driverEmployeeId ? 'driver.reassigned' : 'driver.assigned',
          title: allocation.driverEmployeeId ? 'You have been assigned as replacement driver' : 'You have been assigned as driver',
          body: `You are assigned to request ${allocation.requestReference ?? ''}. Review the trip and acknowledge before departure.`,
          entityType: 'allocation',
          entityId: id,
          actionUrl: '/dashboard/trips',
          workspace: WorkspaceIds.DRIVER,
        });
      }
      if (previousDriver?.userId) {
        await createScopedNotifications({
          tenantId: session.tenantId,
          recipientUserIds: [previousDriver.userId],
          category: 'awareness',
          eventType: 'driver.assignment_removed',
          title: 'Driver assignment changed',
          body: `You are no longer assigned to request ${allocation.requestReference ?? ''}.${cleanReason ? ` Reason: ${cleanReason}` : ''}`,
          entityType: 'allocation',
          entityId: id,
          actionUrl: '/dashboard/trips',
          workspace: WorkspaceIds.DRIVER,
        });
      }

      const { sendNotificationEmail } = await import('@/lib/email');
      if (newDriver?.email) {
        await sendNotificationEmail({
          to: newDriver.email,
          type: 'allocation_created',
          title: allocation.driverEmployeeId ? '🚗 You have been assigned as replacement driver' : '🚗 You have been assigned as driver',
          body: `You have been assigned to allocation for request ${allocation.requestReference ?? ''}. Please review the trip authority in the system.`,
          actionUrl: '/dashboard/trips',
          recipientName: newDriver.firstName || 'Driver',
        });
      }
      if (previousDriver?.email) {
        await sendNotificationEmail({
          to: previousDriver.email,
          type: 'allocation_created',
          title: 'Driver assignment changed',
          body: `You are no longer assigned to request ${allocation.requestReference ?? ''}.${cleanReason ? ` Reason: ${cleanReason}` : ''}`,
          actionUrl: '/dashboard/trips',
          recipientName: previousDriver.firstName || 'Driver',
        });
      }
    } catch (notifyErr) {
      console.warn('[Allocation Driver] Assignment notification failed:', notifyErr);
    }

    return NextResponse.json({ success: true, driverEmployeeId });
  } catch (error) {
    console.error('[Allocation Driver] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to assign driver' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/allocations', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const cleanReason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!cleanReason) {
      return NextResponse.json({ error: 'A reason is required when removing an assigned driver' }, { status: 400 });
    }
    if (cleanReason.length > 500) {
      return NextResponse.json({ error: 'Driver removal reason must be 500 characters or fewer' }, { status: 422 });
    }

    const db = getDb();
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        requestId: vehicleAllocations.requestId,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestReference: transportRequests.reference,
        tripIssuedAt: trips.issuedAt,
        tripDriverAcknowledgedAt: trips.driverAcknowledgedAt,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .leftJoin(trips, and(eq(trips.allocationId, vehicleAllocations.id), eq(trips.tenantId, session.tenantId)))
      .where(and(
        eq(vehicleAllocations.id, id),
        eq(vehicles.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
      ))
      .limit(1);

    if (!allocation) return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    if (!LIVE_ALLOCATION_STATES.includes(allocation.state as typeof LIVE_ALLOCATION_STATES[number])) {
      return NextResponse.json({ error: 'Driver can only be unassigned before physical issue/closure' }, { status: 409 });
    }
    if (allocation.tripIssuedAt || allocation.tripDriverAcknowledgedAt) {
      return NextResponse.json(
        {
          error:
            'The primary driver cannot be removed after driver acknowledgement or physical vehicle issue. Cancel the unissued trip or use the formal in-trip handover process after departure.',
        },
        { status: 409 },
      );
    }
    if (!allocation.driverEmployeeId) {
      return NextResponse.json({ error: 'This allocation has no assigned driver to remove' }, { status: 409 });
    }

    const removedDriverId = allocation.driverEmployeeId;
    const now = new Date();
    const nowIso = now.toISOString();
    try {
      await db.execute(sql`
        WITH allocation_claim AS (
          UPDATE vehicle_allocations va
          SET driver_employee_id = NULL,
              version = va.version + 1,
              updated_at = ${nowIso}::timestamptz
          WHERE va.id = ${id}::uuid
            AND va.state IN ('provisional', 'confirmed')
            AND va.driver_employee_id = ${removedDriverId}::uuid
            AND NOT EXISTS (
              SELECT 1 FROM trips t
              WHERE t.allocation_id = va.id
                AND t.tenant_id = ${session.tenantId}::uuid
                AND (t.issued_at IS NOT NULL OR t.driver_acknowledged_at IS NOT NULL)
            )
          RETURNING va.request_id
        ),
        request_updated AS (
          UPDATE transport_requests tr
          SET assigned_driver_employee_id = NULL, updated_at = ${nowIso}::timestamptz
          FROM allocation_claim ac
          WHERE tr.id = ac.request_id
            AND tr.tenant_id = ${session.tenantId}::uuid
            AND tr.assigned_driver_employee_id = ${removedDriverId}::uuid
          RETURNING tr.id
        ),
        drivers_cleared AS (
          UPDATE request_drivers rd
          SET is_confirmed = false
          FROM request_updated ru
          WHERE rd.request_id = ru.id
          RETURNING rd.id
        )
        SELECT CAST(CASE
          WHEN (SELECT count(*) FROM allocation_claim) = 1
           AND (SELECT count(*) FROM request_updated) = 1
          THEN '1'
          ELSE 'atomic_driver_unassignment_failed_'
            || (SELECT count(*) FROM allocation_claim)::text
            || (SELECT count(*) FROM request_updated)::text
        END AS integer) AS committed
      `);
    } catch (mutationError) {
      if (String(mutationError).includes('atomic_driver_unassignment_failed')) {
        return NextResponse.json(
          { error: 'The trip or driver assignment changed while removal was being saved. Refresh and review the current state.' },
          { status: 409 },
        );
      }
      throw mutationError;
    }

    try {
      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'driver.unassigned',
        entityType: 'allocation',
        entityId: id,
        summary: `Driver removed from allocation. Reason: ${cleanReason}`,
        before: { driverEmployeeId: removedDriverId },
        after: { driverEmployeeId: null, removalReason: cleanReason },
      });
      await recordTenantRequestActivity({
        tenantId: session.tenantId,
        requestId: allocation.requestId,
        reference: allocation.requestReference,
        stage: 'driver_unassigned',
        officeLabel: 'Transport office',
      });
    } catch (auditError) {
      console.warn('[Allocation Driver] Post-commit audit/activity failed:', auditError);
    }

    try {
      const [removedDriver] = await db
        .select({ userId: employees.userId, email: employees.email, firstName: employees.firstName })
        .from(employees)
        .where(and(eq(employees.id, removedDriverId), eq(employees.tenantId, session.tenantId)))
        .limit(1);

      if (removedDriver?.userId) {
        await createScopedNotifications({
          tenantId: session.tenantId,
          recipientUserIds: [removedDriver.userId],
          category: 'awareness',
          eventType: 'driver.assignment_removed',
          title: 'Driver assignment removed',
          body: `You are no longer assigned to request ${allocation.requestReference}. Reason: ${cleanReason}`,
          entityType: 'allocation',
          entityId: id,
          actionUrl: '/dashboard/trips',
          workspace: WorkspaceIds.DRIVER,
        });
      }

      if (removedDriver?.email) {
        const { sendNotificationEmail } = await import('@/lib/email');
        await sendNotificationEmail({
          to: removedDriver.email,
          type: 'allocation_created',
          title: 'Driver assignment removed',
          body: `You are no longer assigned to request ${allocation.requestReference}. Reason: ${cleanReason}`,
          actionUrl: '/dashboard/trips',
          recipientName: removedDriver.firstName || 'Driver',
        });
      }
    } catch (notifyError) {
      console.warn('[Allocation Driver] Unassignment notification failed:', notifyError);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Allocation Driver] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to unassign driver' }, { status: 500 });
  }
}