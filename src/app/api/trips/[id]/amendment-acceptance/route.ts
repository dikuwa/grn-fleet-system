import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { employees } from '@/db/schema/people';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { recordAuditEvent } from '@/lib/audit-event';
import { Permissions } from '@/lib/permissions';
import { findPendingVehicleReplacementAcceptance } from '@/lib/trip-amendment-acceptance';

const ACCEPTANCE_METHODS = ['in_person', 'phone', 'signed_paper', 'secure_link'] as const;
type AcceptanceMethod = (typeof ACCEPTANCE_METHODS)[number];

type RouteContext = { params: Promise<{ id: string }> };

async function loadAcceptanceContext(tripId: string, tenantId: string) {
  const db = getDb();
  const [record] = await db
    .select({
      tripId: trips.id,
      tripStatus: trips.status,
      tripIssuedAt: trips.issuedAt,
      allocationId: vehicleAllocations.id,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      driverUserId: employees.userId,
      authorityId: tripAuthorities.id,
      authorityVersion: tripAuthorities.version,
      authorityAcceptedAt: tripAuthorities.acceptedAt,
      externalAssignmentId: externalDriverAssignments.id,
      externalAssignmentState: externalDriverAssignments.state,
    })
    .from(trips)
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
    .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
    .leftJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
    .leftJoin(
      externalDriverAssignments,
      and(
        eq(externalDriverAssignments.tripId, trips.id),
        eq(externalDriverAssignments.tenantId, tenantId),
      ),
    )
    .where(
      and(
        eq(trips.id, tripId),
        eq(trips.tenantId, tenantId),
        eq(tripAuthorities.tenantId, tenantId),
      ),
    )
    .limit(1);
  return record ?? null;
}

/** Return whether the current authority has a vehicle amendment newer than its latest driver acceptance. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const { id: tripId } = await context.params;
    const record = await loadAcceptanceContext(tripId, session.tenantId);
    if (!record) return NextResponse.json({ error: 'Trip Authority not found' }, { status: 404 });

    const pending = await findPendingVehicleReplacementAcceptance({
      authorityId: record.authorityId,
      acceptedAt: record.authorityAcceptedAt,
    });
    const driverKind = record.driverEmployeeId ? 'internal' : record.externalAssignmentId ? 'external' : 'unassigned';
    const canSelfAcknowledge =
      driverKind === 'internal' && Boolean(record.driverUserId) && record.driverUserId === session.user.id;

    let canRecordExternal = false;
    if (driverKind === 'external') {
      const [routeCheck, permissionCheck] = await Promise.all([
        requireDashboardAction(session, '/dashboard/allocations', 'update'),
        requirePermission(session, Permissions.ALLOCATION_MANAGE),
      ]);
      canRecordExternal =
        !(routeCheck instanceof NextResponse) && !(permissionCheck instanceof NextResponse);
    }

    return NextResponse.json({
      pending: Boolean(pending),
      driverKind,
      canSelfAcknowledge,
      canRecordExternal,
      amendment: pending
        ? {
            id: pending.amendmentId,
            authorityVersion: pending.authorityVersion,
            reason: pending.reason,
            createdAt: pending.createdAt.toISOString(),
            originalValue: pending.originalValue,
            newValue: pending.newValue,
          }
        : null,
    });
  } catch (error) {
    console.error('[amendment-acceptance] GET failed:', error);
    return NextResponse.json({ error: 'Failed to resolve revised authority acceptance state' }, { status: 500 });
  }
}

/**
 * Record acknowledgement of a material Trip Authority amendment without
 * rewriting the driver's original workflow acknowledgement. Internal drivers
 * acknowledge their own revised authority. External-driver re-acceptance is
 * recorded by Transport Administration with the confirmation method retained.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const { id: tripId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      acceptanceMethod?: string;
      note?: string;
    };

    const db = getDb();
    const tenantId = session.tenantId;
    const record = await loadAcceptanceContext(tripId, tenantId);

    if (!record) return NextResponse.json({ error: 'Trip Authority not found' }, { status: 404 });
    if (record.tripStatus !== 'pending' || record.tripIssuedAt) {
      return NextResponse.json(
        { error: 'A revised Trip Authority can only be acknowledged before physical vehicle issue or departure.' },
        { status: 409 },
      );
    }

    const pending = await findPendingVehicleReplacementAcceptance({
      authorityId: record.authorityId,
      acceptedAt: record.authorityAcceptedAt,
    });
    if (!pending) {
      return NextResponse.json(
        { error: 'There is no newer vehicle-replacement amendment awaiting driver acknowledgement.' },
        { status: 409 },
      );
    }

    const internalDriver = Boolean(record.driverEmployeeId);
    let acceptanceMethod: AcceptanceMethod | 'driver_console' = 'driver_console';
    const note = String(body.note || '').trim().slice(0, 1000) || null;

    if (internalDriver) {
      const permission = await requirePermission(session, Permissions.DRIVER_LOG_CREATE);
      if (permission instanceof NextResponse) return permission;
      if (!record.driverUserId || record.driverUserId !== session.user.id) {
        return NextResponse.json(
          { error: 'Only the employee driver currently assigned to this trip may acknowledge the revised authority.' },
          { status: 403 },
        );
      }
    } else {
      if (!record.externalAssignmentId || record.externalAssignmentState !== 'accepted') {
        return NextResponse.json(
          { error: 'The current external driver assignment must already be accepted before a revised authority can be re-acknowledged.' },
          { status: 409 },
        );
      }
      const actionCheck = await requireDashboardAction(session, '/dashboard/allocations', 'update');
      if (actionCheck instanceof NextResponse) return actionCheck;
      const permission = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
      if (permission instanceof NextResponse) return permission;

      const requestedMethod = String(body.acceptanceMethod || '').trim() as AcceptanceMethod;
      if (!ACCEPTANCE_METHODS.includes(requestedMethod)) {
        return NextResponse.json(
          { error: 'Select how the external driver confirmed the revised Trip Authority.' },
          { status: 422 },
        );
      }
      acceptanceMethod = requestedMethod;
    }

    const now = new Date();
    const acceptanceEvidence = JSON.stringify({
      source: internalDriver ? 'driver_console_amendment' : 'transport_office_external_amendment',
      amendmentId: pending.amendmentId,
      authorityVersion: pending.authorityVersion,
      acceptanceMethod,
      note,
      acceptedAt: now.toISOString(),
      recordedByUserId: session.user.id,
      externalDriverAssignmentId: record.externalAssignmentId ?? null,
    });

    await db.execute(sql`
      WITH amendment_claim AS (
        UPDATE trip_amendments am
        SET status = status
        WHERE am.id = ${pending.amendmentId}::uuid
          AND am.authority_id = ${record.authorityId}::uuid
          AND am.amendment_type = 'vehicle_replacement'
          AND am.status = 'approved'
          AND EXISTS (
            SELECT 1
            FROM trip_authorities ta
            WHERE ta.id = am.authority_id
              AND ta.tenant_id = ${tenantId}::uuid
              AND ta.accepted_at IS NOT NULL
              AND am.created_at > ta.accepted_at
          )
        RETURNING id
      ),
      authority_claim AS (
        UPDATE trip_authorities ta
        SET accepted_at = ${now},
            accepted_by_employee_id = ${record.driverEmployeeId ?? null}::uuid,
            acceptance_data = COALESCE(ta.acceptance_data, '{}'::jsonb)
              || jsonb_build_object('latestAmendmentAcceptance', ${acceptanceEvidence}::jsonb),
            status = 'awaiting_pre_trip_inspection',
            updated_at = ${now}
        WHERE ta.id = ${record.authorityId}::uuid
          AND ta.tenant_id = ${tenantId}::uuid
          AND ta.trip_id = ${tripId}::uuid
          AND EXISTS (SELECT 1 FROM amendment_claim)
        RETURNING id
      ),
      trip_claim AS (
        UPDATE trips t
        SET driver_acknowledged_at = ${now},
            driver_acknowledged_by_employee_id = ${record.driverEmployeeId ?? null}::uuid,
            updated_at = ${now}
        WHERE t.id = ${tripId}::uuid
          AND t.tenant_id = ${tenantId}::uuid
          AND t.status = 'pending'
          AND t.issued_at IS NULL
          AND EXISTS (SELECT 1 FROM authority_claim)
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM amendment_claim) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM trip_claim) = 1
        THEN '1'
        ELSE 'atomic_amendment_acknowledgement_failed_'
          || (SELECT count(*) FROM amendment_claim)::text
          || (SELECT count(*) FROM authority_claim)::text
          || (SELECT count(*) FROM trip_claim)::text
      END AS integer) AS committed
    `);

    await recordAuditEvent({
      tenantId,
      actorUserId: session.user.id,
      actorEmployeeId: record.driverEmployeeId,
      action: 'trip_authority.amendment_acknowledged',
      eventType: 'trip_authority_amendment_acknowledged',
      entityType: 'trip_amendment',
      entityId: pending.amendmentId,
      summary: internalDriver
        ? 'Assigned driver acknowledged the revised Trip Authority after vehicle replacement.'
        : 'Transport Administration recorded external-driver acceptance of the revised Trip Authority.',
      reason: pending.reason,
      before: {
        authorityVersion: pending.authorityVersion,
        acceptedAt: record.authorityAcceptedAt?.toISOString() ?? null,
        amendmentCreatedAt: pending.createdAt.toISOString(),
      },
      after: JSON.parse(acceptanceEvidence),
    }).catch((error) =>
      console.warn('[amendment-acceptance] Acknowledgement committed but audit event failed:', error),
    );

    return NextResponse.json({
      success: true,
      amendmentId: pending.amendmentId,
      authorityId: record.authorityId,
      authorityVersion: pending.authorityVersion,
      acceptedAt: now.toISOString(),
      driverKind: internalDriver ? 'internal' : 'external',
      nextStage: 'awaiting_pre_trip_inspection',
    });
  } catch (error) {
    console.error('[amendment-acceptance] POST failed:', error);
    if (String(error).includes('atomic_amendment_acknowledgement_failed')) {
      return NextResponse.json(
        { error: 'The revised authority changed while acknowledgement was being recorded. Refresh and review the latest authority.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to acknowledge revised Trip Authority' }, { status: 500 });
  }
}
