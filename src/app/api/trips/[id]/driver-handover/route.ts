import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gt, inArray, isNull, lt, ne, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripAuthorisedDrivers,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import {
  hasPermission,
  requireAnyPermission,
  requireDashboardAction,
  requireRequestAuth,
  type AuthSession,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

const ACTIVE_HANDOVER_STATUSES = ['in_progress', 'return_due'] as const;
const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;

function maskLicence(value: string) {
  const clean = value.trim();
  if (clean.length <= 4) return clean;
  return `${'*'.repeat(Math.min(6, clean.length - 4))}${clean.slice(-4)}`;
}

async function notifyTransport(tenantId: string, tripId: string, title: string, body: string) {
  const recipients = await resolveActiveRoleRecipients(tenantId, [SystemRoles.TRANSPORT_ADMIN]);
  if (!recipients.length) return;
  await createScopedNotifications({
    tenantId,
    recipientUserIds: recipients,
    category: 'action_required',
    eventType: 'driver_handover',
    title,
    body,
    entityType: 'trip',
    entityId: tripId,
    actionUrl: `/dashboard/trips/${tripId}`,
    workspace: WorkspaceIds.TRANSPORT_ADMIN,
    priority: 'high',
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const { id: tripId } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'initiate' | 'acknowledge';
      newDriverEmployeeId?: string;
      handoverOdometer?: number;
      reason?: string;
      note?: string;
    };

    if (body.action === 'acknowledge') {
      return acknowledgeHandover(session, tripId, body.note);
    }
    if (body.action !== 'initiate') {
      return NextResponse.json({ error: 'action must be initiate or acknowledge' }, { status: 400 });
    }

    const routeCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permissionCheck = await requireAnyPermission(session, [
      Permissions.ALLOCATION_MANAGE,
      Permissions.TRIP_MANAGE,
    ]);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const newDriverEmployeeId = String(body.newDriverEmployeeId || '').trim();
    const reason = String(body.reason || '').trim();
    const handoverOdometer = Number(body.handoverOdometer);
    if (!newDriverEmployeeId) {
      return NextResponse.json({ error: 'Select the relief driver' }, { status: 422 });
    }
    if (reason.length < 10 || reason.length > 500) {
      return NextResponse.json({ error: 'Handover reason must be 10–500 characters' }, { status: 422 });
    }
    if (!Number.isInteger(handoverOdometer) || handoverOdometer < 0) {
      return NextResponse.json({ error: 'Handover odometer must be a non-negative whole number' }, { status: 422 });
    }

    const db = getDb();
    const [context] = await db
      .select({
        tripStatus: trips.status,
        allocationId: vehicleAllocations.id,
        allocationState: vehicleAllocations.state,
        currentDriverEmployeeId: vehicleAllocations.driverEmployeeId,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
        authorityId: tripAuthorities.id,
        authorityVersion: tripAuthorities.version,
        authorityValidUntil: tripAuthorities.validUntil,
        requestReference: transportRequests.reference,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(
        and(
          eq(trips.id, tripId),
          eq(trips.tenantId, session.tenantId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(tripAuthorities.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!context) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    if (!ACTIVE_HANDOVER_STATUSES.includes(context.tripStatus as (typeof ACTIVE_HANDOVER_STATUSES)[number])) {
      return NextResponse.json({ error: 'Driver handover is only available while a trip is active' }, { status: 409 });
    }
    if (context.allocationState !== 'confirmed' || !context.currentDriverEmployeeId) {
      return NextResponse.json({ error: 'The active trip does not have a confirmed current driver' }, { status: 409 });
    }
    if (context.currentDriverEmployeeId === newDriverEmployeeId) {
      return NextResponse.json({ error: 'Select a different relief driver' }, { status: 422 });
    }

    const [pendingHandover] = await db
      .select({ id: tripAuthorisedDrivers.id, employeeId: tripAuthorisedDrivers.employeeId })
      .from(tripAuthorisedDrivers)
      .where(
        and(
          eq(tripAuthorisedDrivers.authorityId, context.authorityId),
          eq(tripAuthorisedDrivers.driverType, 'relief'),
          isNull(tripAuthorisedDrivers.acknowledgedAt),
        ),
      )
      .limit(1);
    if (pendingHandover) {
      return NextResponse.json(
        { error: 'This trip already has a relief-driver handover awaiting acknowledgement' },
        { status: 409 },
      );
    }

    const [newDriver] = await db
      .select({
        employeeId: employees.id,
        userId: employees.userId,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        licenceNumber: driverLicences.licenceNumber,
        licenceClass: driverLicences.licenceClass,
        licenceExpiry: driverLicences.expiryDate,
      })
      .from(employees)
      .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(employees.id, newDriverEmployeeId),
          eq(employees.tenantId, session.tenantId),
          eq(employees.employmentStatus, 'active'),
          eq(employees.isDriver, true),
          eq(driverProfiles.driverStatus, 'authorised'),
          eq(driverLicences.verificationStatus, 'verified'),
          eq(driverLicences.isActive, true),
        ),
      )
      .orderBy(desc(driverLicences.expiryDate))
      .limit(1);

    if (!newDriver) {
      return NextResponse.json(
        { error: 'The selected relief driver is not active, authorised, or does not have an active verified licence' },
        { status: 409 },
      );
    }
    const requiredUntil = context.authorityValidUntil ?? new Date();
    if (new Date(`${newDriver.licenceExpiry}T23:59:59Z`) < requiredUntil) {
      return NextResponse.json(
        { error: 'The relief driver licence does not remain valid through the authorised trip period' },
        { status: 409 },
      );
    }

    const [driverConflict] = await db
      .select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .innerJoin(transportRequests, eq(transportRequests.id, vehicleAllocations.requestId))
      .where(
        and(
          eq(transportRequests.tenantId, session.tenantId),
          eq(vehicleAllocations.driverEmployeeId, newDriverEmployeeId),
          ne(vehicleAllocations.id, context.allocationId),
          inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
          lt(vehicleAllocations.startAt, context.endAt),
          gt(vehicleAllocations.endAt, context.startAt),
        ),
      )
      .limit(1);
    if (driverConflict) {
      return NextResponse.json({ error: 'The relief driver already has an overlapping live allocation' }, { status: 409 });
    }

    const [currentDriver] = await db
      .select({ employeeNumber: employees.employeeNumber, firstName: employees.firstName, lastName: employees.lastName })
      .from(employees)
      .where(and(eq(employees.id, context.currentDriverEmployeeId), eq(employees.tenantId, session.tenantId)))
      .limit(1);

    const now = new Date();
    const previousDriverName = currentDriver
      ? `${currentDriver.firstName} ${currentDriver.lastName}`.trim()
      : context.currentDriverEmployeeId;
    const nextDriverName = `${newDriver.firstName} ${newDriver.lastName}`.trim();
    const maskedLicence = maskLicence(newDriver.licenceNumber);
    const amendmentPayload = JSON.stringify({
      previousDriverEmployeeId: context.currentDriverEmployeeId,
      newDriverEmployeeId,
      handoverOdometer,
      reason,
      state: 'awaiting_relief_driver_acknowledgement',
    });

    await db.execute(sql`
      WITH authority_claim AS (
        UPDATE trip_authorities
        SET version = version + 1,
            document_version = document_version + 1,
            updated_at = ${now}
        WHERE id = ${context.authorityId}::uuid
          AND tenant_id = ${session.tenantId}::uuid
          AND version = ${context.authorityVersion}
          AND NOT EXISTS (
            SELECT 1 FROM trip_authorised_drivers pending
            WHERE pending.authority_id = ${context.authorityId}::uuid
              AND pending.driver_type = 'relief'
              AND pending.acknowledged_at IS NULL
          )
        RETURNING *
      ),
      previous_driver AS (
        INSERT INTO trip_authorised_drivers (
          authority_id, employee_id, driver_type, employee_number, reason,
          authorised_by_user_id, authorised_at, handover_odometer, acknowledged_at
        )
        SELECT
          id,
          ${context.currentDriverEmployeeId}::uuid,
          'primary',
          ${currentDriver?.employeeNumber ?? null},
          ${reason},
          ${session.user.id},
          ${now},
          ${handoverOdometer},
          ${now}
        FROM authority_claim
        ON CONFLICT (authority_id, employee_id) DO UPDATE SET
          handover_odometer = EXCLUDED.handover_odometer,
          reason = EXCLUDED.reason
        RETURNING id
      ),
      next_driver AS (
        INSERT INTO trip_authorised_drivers (
          authority_id, employee_id, driver_type, employee_number,
          licence_number_masked, licence_class, licence_expiry, reason,
          authorised_by_user_id, authorised_at, takeover_odometer, acknowledged_at
        )
        SELECT
          ${context.authorityId}::uuid,
          ${newDriverEmployeeId}::uuid,
          'relief',
          ${newDriver.employeeNumber},
          ${maskedLicence},
          ${newDriver.licenceClass},
          ${new Date(`${newDriver.licenceExpiry}T23:59:59Z`)},
          ${reason},
          ${session.user.id},
          ${now},
          ${handoverOdometer},
          NULL
        FROM previous_driver
        ON CONFLICT (authority_id, employee_id) DO UPDATE SET
          driver_type = 'relief',
          employee_number = EXCLUDED.employee_number,
          licence_number_masked = EXCLUDED.licence_number_masked,
          licence_class = EXCLUDED.licence_class,
          licence_expiry = EXCLUDED.licence_expiry,
          reason = EXCLUDED.reason,
          authorised_by_user_id = EXCLUDED.authorised_by_user_id,
          authorised_at = EXCLUDED.authorised_at,
          takeover_odometer = EXCLUDED.takeover_odometer,
          acknowledged_at = NULL
        RETURNING id
      ),
      amendment_insert AS (
        INSERT INTO trip_amendments (
          authority_id, amendment_type, original_value, new_value, reason,
          status, requested_by_user_id, approved_by_user_id, approved_at, version
        )
        SELECT
          id,
          'driver_handover',
          jsonb_build_object('driverEmployeeId', ${context.currentDriverEmployeeId}::text),
          ${amendmentPayload}::jsonb,
          ${reason},
          'approved',
          ${session.user.id},
          ${session.user.id},
          ${now},
          version
        FROM authority_claim
        WHERE EXISTS (SELECT 1 FROM next_driver)
        RETURNING id
      ),
      version_insert AS (
        INSERT INTO trip_authority_versions (
          authority_id, version, status, snapshot, reason, created_by_user_id
        )
        SELECT id, version, status, to_jsonb(authority_claim), ${reason}, ${session.user.id}
        FROM authority_claim
        WHERE EXISTS (SELECT 1 FROM amendment_insert)
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, summary, before, after, reason, source_channel
        )
        SELECT
          ${session.tenantId}::uuid,
          ${Date.now()},
          'trip_driver_handover_initiated',
          ${session.user.id},
          'handover_driver',
          'trip',
          ${tripId}::uuid,
          ${`Driver handover prepared: ${previousDriverName} → ${nextDriverName}`},
          jsonb_build_object('driverEmployeeId', ${context.currentDriverEmployeeId}::text),
          ${amendmentPayload}::jsonb,
          ${reason},
          'web'
        FROM version_insert
        RETURNING id
      )
      SELECT (SELECT count(*) FROM audit_insert) AS committed
    `);

    const [pending] = await db
      .select({ id: tripAuthorisedDrivers.id })
      .from(tripAuthorisedDrivers)
      .where(
        and(
          eq(tripAuthorisedDrivers.authorityId, context.authorityId),
          eq(tripAuthorisedDrivers.employeeId, newDriverEmployeeId),
          eq(tripAuthorisedDrivers.driverType, 'relief'),
          isNull(tripAuthorisedDrivers.acknowledgedAt),
        ),
      )
      .limit(1);
    if (!pending) {
      return NextResponse.json(
        { error: 'The trip changed while the handover was being prepared. Refresh and try again.' },
        { status: 409 },
      );
    }

    if (newDriver.userId) {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: [newDriver.userId],
        category: 'action_required',
        eventType: 'driver_handover_assigned',
        title: 'Driver handover requires acknowledgement',
        body: `${context.requestReference}: proposed takeover at odometer ${handoverOdometer.toLocaleString()} km. Review and acknowledge before the assignment transfers to you.`,
        entityType: 'trip',
        entityId: tripId,
        actionUrl: '/dashboard/driver-mobile',
        workspace: WorkspaceIds.DRIVER,
        priority: 'high',
      }).catch(() => {});
    }

    return NextResponse.json({
      success: true,
      handoverPending: true,
      previousDriver: previousDriverName,
      newDriver: nextDriverName,
      handoverOdometer,
    });
  } catch (error) {
    console.error('[trips/driver-handover] POST failed:', error);
    return NextResponse.json(
      { error: 'Driver handover could not be saved. Refresh and try again.' },
      { status: 500 },
    );
  }
}

async function acknowledgeHandover(session: AuthSession, tripId: string, note?: string) {
  const routeCheck = await requireDashboardAction(session, '/dashboard/driver-mobile', 'update');
  if (routeCheck instanceof NextResponse) return routeCheck;
  const canDrive = await hasPermission(session, Permissions.DRIVER_LOG_CREATE);
  if (!canDrive) return NextResponse.json({ error: 'Driver permission is required' }, { status: 403 });

  const db = getDb();
  const [employee] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(
      and(
        eq(employees.userId, session.user.id),
        eq(employees.tenantId, session.tenantId),
        eq(employees.employmentStatus, 'active'),
      ),
    )
    .limit(1);
  if (!employee) return NextResponse.json({ error: 'Active driver record not found' }, { status: 404 });

  const [context] = await db
    .select({
      status: trips.status,
      requestReference: transportRequests.reference,
      allocationId: vehicleAllocations.id,
      allocationVersion: vehicleAllocations.version,
      currentDriverEmployeeId: vehicleAllocations.driverEmployeeId,
      authorityId: tripAuthorities.id,
      validUntil: tripAuthorities.validUntil,
      takeoverOdometer: tripAuthorisedDrivers.takeoverOdometer,
      reliefDriverId: tripAuthorisedDrivers.id,
    })
    .from(tripAuthorisedDrivers)
    .innerJoin(tripAuthorities, eq(tripAuthorities.id, tripAuthorisedDrivers.authorityId))
    .innerJoin(trips, eq(trips.id, tripAuthorities.tripId))
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
    .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.tenantId, session.tenantId),
        eq(transportRequests.tenantId, session.tenantId),
        eq(tripAuthorities.tenantId, session.tenantId),
        eq(tripAuthorisedDrivers.employeeId, employee.id),
        eq(tripAuthorisedDrivers.driverType, 'relief'),
        isNull(tripAuthorisedDrivers.acknowledgedAt),
        eq(vehicleAllocations.state, 'confirmed'),
      ),
    )
    .limit(1);

  if (!context) return NextResponse.json({ error: 'Pending handover assignment not found' }, { status: 404 });
  if (!ACTIVE_HANDOVER_STATUSES.includes(context.status as (typeof ACTIVE_HANDOVER_STATUSES)[number])) {
    return NextResponse.json({ error: 'This trip is no longer active for a driver handover' }, { status: 409 });
  }
  if (!context.currentDriverEmployeeId || context.currentDriverEmployeeId === employee.id) {
    return NextResponse.json({ error: 'This handover is no longer awaiting transfer' }, { status: 409 });
  }

  const [licence] = await db
    .select({ expiryDate: driverLicences.expiryDate, driverStatus: driverProfiles.driverStatus })
    .from(driverProfiles)
    .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
    .where(
      and(
        eq(driverProfiles.employeeId, employee.id),
        eq(driverProfiles.driverStatus, 'authorised'),
        eq(driverLicences.verificationStatus, 'verified'),
        eq(driverLicences.isActive, true),
      ),
    )
    .orderBy(desc(driverLicences.expiryDate))
    .limit(1);
  if (!licence || new Date(`${licence.expiryDate}T23:59:59Z`) < (context.validUntil ?? new Date())) {
    return NextResponse.json({ error: 'A verified licence valid through the authorised trip period is required' }, { status: 409 });
  }

  const [driverConflict] = await db
    .select({ id: vehicleAllocations.id })
    .from(vehicleAllocations)
    .innerJoin(transportRequests, eq(transportRequests.id, vehicleAllocations.requestId))
    .where(
      and(
        eq(transportRequests.tenantId, session.tenantId),
        eq(vehicleAllocations.driverEmployeeId, employee.id),
        ne(vehicleAllocations.id, context.allocationId),
        inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
      ),
    )
    .limit(1);
  if (driverConflict) {
    return NextResponse.json({ error: 'You now have another live allocation. Transport Administration must review the handover.' }, { status: 409 });
  }

  const now = new Date();
  await db.execute(sql`
    WITH allocation_claim AS (
      UPDATE vehicle_allocations
      SET driver_employee_id = ${employee.id}::uuid,
          version = version + 1,
          updated_at = ${now}
      WHERE id = ${context.allocationId}::uuid
        AND state = 'confirmed'
        AND version = ${context.allocationVersion}
        AND driver_employee_id = ${context.currentDriverEmployeeId}::uuid
        AND EXISTS (
          SELECT 1 FROM trip_authorised_drivers pending
          WHERE pending.id = ${context.reliefDriverId}::uuid
            AND pending.employee_id = ${employee.id}::uuid
            AND pending.driver_type = 'relief'
            AND pending.acknowledged_at IS NULL
        )
      RETURNING id
    ),
    trip_claim AS (
      UPDATE trips
      SET driver_acknowledged_at = ${now},
          driver_acknowledged_by_employee_id = ${employee.id}::uuid,
          version = version + 1,
          updated_at = ${now}
      WHERE id = ${tripId}::uuid
        AND tenant_id = ${session.tenantId}::uuid
        AND status IN ('in_progress', 'return_due')
        AND allocation_id = ${context.allocationId}::uuid
        AND EXISTS (SELECT 1 FROM allocation_claim)
      RETURNING id
    ),
    relief_ack AS (
      UPDATE trip_authorised_drivers
      SET acknowledged_at = ${now}
      WHERE id = ${context.reliefDriverId}::uuid
        AND authority_id = ${context.authorityId}::uuid
        AND employee_id = ${employee.id}::uuid
        AND acknowledged_at IS NULL
        AND EXISTS (SELECT 1 FROM trip_claim)
      RETURNING id
    ),
    audit_insert AS (
      INSERT INTO audit_events (
        tenant_id, tenant_sequence, event_type, actor_user_id, actor_employee_id,
        action, entity_type, entity_id, summary, reason, after, source_channel
      )
      SELECT
        ${session.tenantId}::uuid,
        ${Date.now()},
        'trip_driver_handover_acknowledged',
        ${session.user.id},
        ${employee.id}::uuid,
        'acknowledge_handover',
        'trip',
        ${tripId}::uuid,
        ${`Driver handover acknowledged for ${context.requestReference}`},
        ${note?.trim() || null},
        jsonb_build_object(
          'previousDriverEmployeeId', ${context.currentDriverEmployeeId}::text,
          'newDriverEmployeeId', ${employee.id}::text,
          'takeoverOdometer', ${context.takeoverOdometer}
        ),
        'web'
      FROM relief_ack
      RETURNING id
    )
    SELECT (SELECT count(*) FROM audit_insert) AS committed
  `);

  const [updated] = await db
    .select({
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      acknowledgedAt: trips.driverAcknowledgedAt,
      acknowledgedBy: trips.driverAcknowledgedByEmployeeId,
    })
    .from(trips)
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
    .where(and(eq(trips.id, tripId), eq(trips.tenantId, session.tenantId)))
    .limit(1);
  if (
    updated?.driverEmployeeId !== employee.id ||
    !updated.acknowledgedAt ||
    updated.acknowledgedBy !== employee.id
  ) {
    return NextResponse.json({ error: 'The handover changed before acknowledgement. Refresh the trip.' }, { status: 409 });
  }

  await notifyTransport(
    session.tenantId,
    tripId,
    'Relief driver acknowledged handover',
    `${context.requestReference}: the relief driver accepted the handover at ${context.takeoverOdometer?.toLocaleString() ?? 'the recorded'} km and is now the active assigned driver.`,
  ).catch(() => {});

  return NextResponse.json({ success: true, acknowledgedAt: updated.acknowledgedAt });
}
