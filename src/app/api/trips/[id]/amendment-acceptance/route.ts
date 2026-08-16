import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { recordAuditEvent } from '@/lib/audit-event';
import { onTripIssued } from '@/lib/document-generator';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';
import {
  createScopedNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { Permissions } from '@/lib/permissions';
import { findPendingAuthorityAmendmentAcceptance } from '@/lib/trip-amendment-acceptance';
import { SystemRoles } from '@/lib/workspaces';

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
      allocationVersion: vehicleAllocations.version,
      allocationEndAt: vehicleAllocations.endAt,
      vehicleId: vehicleAllocations.vehicleId,
      vehicleRequiredLicenceClass: vehicles.requiredLicenceClass,
      vehicleProfessionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
      driverEmployeeId: vehicleAllocations.driverEmployeeId,
      driverUserId: employees.userId,
      authorityId: tripAuthorities.id,
      authorityVersion: tripAuthorities.version,
      authorityAcceptedAt: tripAuthorities.acceptedAt,
      externalAssignmentId: externalDriverAssignments.id,
      externalAssignmentState: externalDriverAssignments.state,
      externalPartyId: externalDriverAssignments.externalPartyId,
      externalLicenceId: externalDriverAssignments.licenceId,
      externalPartyStatus: externalParties.status,
      externalLicenceStatus: externalDriverLicences.verificationStatus,
      externalLicenceClass: externalDriverLicences.licenceClass,
      externalLicenceExpiry: externalDriverLicences.expiryDate,
    })
    .from(trips)
    .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
    .innerJoin(
      vehicles,
      and(eq(vehicles.id, vehicleAllocations.vehicleId), eq(vehicles.tenantId, tenantId)),
    )
    .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
    .leftJoin(employees, eq(employees.id, vehicleAllocations.driverEmployeeId))
    .leftJoin(
      externalDriverAssignments,
      and(
        eq(externalDriverAssignments.tripId, trips.id),
        eq(externalDriverAssignments.tenantId, tenantId),
      ),
    )
    .leftJoin(
      externalParties,
      and(
        eq(externalParties.id, externalDriverAssignments.externalPartyId),
        eq(externalParties.tenantId, tenantId),
      ),
    )
    .leftJoin(
      externalDriverLicences,
      and(
        eq(externalDriverLicences.id, externalDriverAssignments.licenceId),
        eq(externalDriverLicences.tenantId, tenantId),
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

function externalEligibilityError(record: NonNullable<Awaited<ReturnType<typeof loadAcceptanceContext>>>) {
  if (record.externalAssignmentState !== 'accepted') {
    return 'The current external driver assignment is no longer accepted.';
  }
  if (record.externalPartyStatus !== 'active') {
    return 'The external driver is no longer active.';
  }
  if (record.externalLicenceStatus !== 'verified') {
    return 'The external driver licence is no longer verified.';
  }
  const expiryAt = record.externalLicenceExpiry
    ? new Date(`${record.externalLicenceExpiry}T23:59:59.999Z`)
    : null;
  if (!expiryAt || !Number.isFinite(expiryAt.getTime()) || expiryAt < record.allocationEndAt) {
    return 'The external driver licence no longer covers the full trip period.';
  }
  if (
    record.vehicleRequiredLicenceClass &&
    !namibiaLicenceClassCovers(record.externalLicenceClass, record.vehicleRequiredLicenceClass)
  ) {
    return `The external driver licence (${record.externalLicenceClass || 'unknown'}) does not cover the current vehicle class (${record.vehicleRequiredLicenceClass}).`;
  }
  if (record.vehicleProfessionalAuthorisationRequired) {
    return 'The current vehicle requires professional driving authorisation, but verified external professional-authorisation evidence is not available for this assignment.';
  }
  return null;
}

/** Return whether the current authority has a driver-material amendment newer than its latest acceptance. */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const { id: tripId } = await context.params;
    const record = await loadAcceptanceContext(tripId, session.tenantId);
    if (!record) return NextResponse.json({ error: 'Trip Authority not found' }, { status: 404 });

    const pending = await findPendingAuthorityAmendmentAcceptance({
      authorityId: record.authorityId,
      acceptedAt: record.authorityAcceptedAt,
    });
    const driverKind = record.driverEmployeeId ? 'internal' : record.externalAssignmentId ? 'external' : 'unassigned';
    const canSelfAcknowledge =
      driverKind === 'internal' && Boolean(record.driverUserId) && record.driverUserId === session.user.id;

    let canRecordExternal = false;
    let eligibilityError: string | null = null;
    if (driverKind === 'external') {
      eligibilityError = externalEligibilityError(record);
      if (!eligibilityError) {
        const [routeCheck, permissionCheck] = await Promise.all([
          requireDashboardAction(session, '/dashboard/allocations', 'update'),
          requirePermission(session, Permissions.ALLOCATION_MANAGE),
        ]);
        canRecordExternal =
          !(routeCheck instanceof NextResponse) && !(permissionCheck instanceof NextResponse);
      }
    }

    return NextResponse.json({
      pending: Boolean(pending),
      driverKind,
      canSelfAcknowledge,
      canRecordExternal,
      externalEligibilityError: eligibilityError,
      amendment: pending
        ? {
            id: pending.amendmentId,
            amendmentType: pending.amendmentType,
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

    const pending = await findPendingAuthorityAmendmentAcceptance({
      authorityId: record.authorityId,
      acceptedAt: record.authorityAcceptedAt,
    });
    if (!pending) {
      return NextResponse.json(
        { error: 'There is no newer material Trip Authority amendment awaiting driver acknowledgement.' },
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
      if (!record.externalAssignmentId) {
        return NextResponse.json({ error: 'No external driver assignment is attached to this trip.' }, { status: 409 });
      }
      const eligibilityError = externalEligibilityError(record);
      if (eligibilityError) {
        return NextResponse.json({ error: eligibilityError }, { status: 409 });
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
      amendmentType: pending.amendmentType,
      authorityVersion: pending.authorityVersion,
      allocationVersion: record.allocationVersion + 1,
      acceptedVehicleId: record.vehicleId,
      acceptanceMethod,
      note,
      acceptedAt: now.toISOString(),
      recordedByUserId: session.user.id,
      externalDriverAssignmentId: record.externalAssignmentId ?? null,
    });

    const externalEligibilityCurrent = internalDriver
      ? sql`true`
      : sql`exists (
          select 1
          from external_driver_assignments eda
          inner join external_parties ep on ep.id = eda.external_party_id
          inner join external_driver_licences edl on edl.id = eda.licence_id
          inner join vehicle_allocations va on va.id = eda.allocation_id
          inner join vehicles v on v.id = va.vehicle_id
          where eda.id = ${record.externalAssignmentId}::uuid
            and eda.tenant_id = ${tenantId}::uuid
            and eda.trip_id = ${tripId}::uuid
            and eda.allocation_id = ${record.allocationId}::uuid
            and eda.state = 'accepted'
            and eda.issue_id is null
            and ep.tenant_id = ${tenantId}::uuid
            and ep.status = 'active'
            and edl.tenant_id = ${tenantId}::uuid
            and edl.id = ${record.externalLicenceId}::uuid
            and edl.verification_status = 'verified'
            and edl.licence_class = ${record.externalLicenceClass}
            and edl.expiry_date >= va.end_at::date
            and va.vehicle_id = ${record.vehicleId}::uuid
            and v.tenant_id = ${tenantId}::uuid
            and v.professional_authorisation_required = false
        )`;

    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations va
        SET version = version + 1,
            updated_at = ${now}
        WHERE va.id = ${record.allocationId}::uuid
          AND va.version = ${record.allocationVersion}
          AND va.vehicle_id = ${record.vehicleId}::uuid
          AND va.state IN ('provisional', 'confirmed')
          AND EXISTS (
            SELECT 1
            FROM trips t
            WHERE t.id = ${tripId}::uuid
              AND t.tenant_id = ${tenantId}::uuid
              AND t.allocation_id = va.id
              AND t.vehicle_id = va.vehicle_id
              AND t.status = 'pending'
              AND t.issued_at IS NULL
          )
          AND ${externalEligibilityCurrent}
        RETURNING id
      ),
      amendment_claim AS (
        UPDATE trip_amendments am
        SET status = status
        WHERE am.id = ${pending.amendmentId}::uuid
          AND am.authority_id = ${record.authorityId}::uuid
          AND am.amendment_type = ${pending.amendmentType}
          AND am.status = 'approved'
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND EXISTS (
            SELECT 1
            FROM trip_authorities ta
            WHERE ta.id = am.authority_id
              AND ta.tenant_id = ${tenantId}::uuid
              AND ta.accepted_at IS NOT NULL
              AND COALESCE(am.approved_at, am.created_at) > ta.accepted_at
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
          AND ta.allocation_id = ${record.allocationId}::uuid
          AND ta.accepted_at IS NOT NULL
          AND ta.accepted_at < ${pending.createdAt}
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
          AND t.vehicle_id = ${record.vehicleId}::uuid
          AND t.allocation_id = ${record.allocationId}::uuid
          AND EXISTS (SELECT 1 FROM authority_claim)
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM allocation_claim) = 1
         AND (SELECT count(*) FROM amendment_claim) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM trip_claim) = 1
        THEN '1'
        ELSE 'atomic_amendment_acknowledgement_failed_'
          || (SELECT count(*) FROM allocation_claim)::text
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
        ? `Assigned driver acknowledged the revised Trip Authority (${pending.amendmentType.replaceAll('_', ' ')}).`
        : `Transport Administration recorded external-driver acceptance of the revised Trip Authority (${pending.amendmentType.replaceAll('_', ' ')}).`,
      reason: pending.reason,
      before: {
        authorityVersion: pending.authorityVersion,
        allocationVersion: record.allocationVersion,
        vehicleId: record.vehicleId,
        acceptedAt: record.authorityAcceptedAt?.toISOString() ?? null,
        amendmentCreatedAt: pending.createdAt.toISOString(),
      },
      after: JSON.parse(acceptanceEvidence),
    }).catch((error) =>
      console.warn('[amendment-acceptance] Acknowledgement committed but audit event failed:', error),
    );

    let documentId: string | null = null;
    try {
      const refreshed = await onTripIssued(record.allocationId, tenantId, session.user.id);
      documentId = refreshed?.id ?? null;
    } catch (error) {
      console.warn('[amendment-acceptance] Acceptance committed but authority draft refresh failed:', error);
    }

    const inspectionRecipients = await resolveActiveRoleRecipients(tenantId, [
      SystemRoles.INSPECTOR,
      SystemRoles.RELEASE_OFFICER,
    ]).catch(() => []);
    if (inspectionRecipients.length) {
      await createScopedNotifications({
        tenantId,
        recipientUserIds: inspectionRecipients,
        category: 'action_required',
        eventType: 'departure_inspection_required',
        title: 'Revised authority ready for departure inspection',
        body: `The assigned driver has acknowledged a ${pending.amendmentType.replaceAll('_', ' ')} amendment. Complete a fresh official departure inspection before final Trip Authority issue and physical vehicle issue.`,
        entityType: 'trip',
        entityId: tripId,
        actionUrl: `/dashboard/inspections/new?type=departure&tripId=${tripId}&vehicleId=${record.vehicleId}`,
        workspace: null,
        priority: 'high',
      }).catch((error) =>
        console.warn('[amendment-acceptance] Inspection notification failed:', error),
      );
    }

    return NextResponse.json({
      success: true,
      amendmentId: pending.amendmentId,
      amendmentType: pending.amendmentType,
      authorityId: record.authorityId,
      authorityVersion: pending.authorityVersion,
      documentId,
      acceptedAt: now.toISOString(),
      driverKind: internalDriver ? 'internal' : 'external',
      nextStage: 'awaiting_pre_trip_inspection',
    });
  } catch (error) {
    console.error('[amendment-acceptance] POST failed:', error);
    if (String(error).includes('atomic_amendment_acknowledgement_failed')) {
      return NextResponse.json(
        { error: 'The revised authority changed or the driver became ineligible while acknowledgement was being recorded. Refresh and review the latest authority.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to acknowledge revised Trip Authority' }, { status: 500 });
  }
}
