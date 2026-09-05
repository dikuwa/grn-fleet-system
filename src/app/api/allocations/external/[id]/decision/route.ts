import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { transportRequests } from '@/db/schema/requests';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { recordAuditEvent } from '@/lib/audit-event';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

const ACCEPTANCE_METHODS = ['in_person', 'phone', 'signed_paper', 'secure_link'] as const;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Record or cancel an external driver's acceptance of an operational assignment.
 *
 * External acceptance deliberately happens BEFORE final Trip Authority
 * authorisation. The accepted assignment is the evidence the final authoriser
 * consumes when provisioning the immutable Trip Authority. Requiring an
 * authority here would create a circular dependency (authority needs accepted
 * driver evidence, while acceptance would need an authority).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const actionCheck = await requireDashboardAction(session, '/dashboard/allocations', 'update');
    if (actionCheck instanceof NextResponse) return actionCheck;
    const permissionCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'accept' | 'cancel';
      acceptanceMethod?: string;
      note?: string;
      reason?: string;
    };
    const action = body.action;
    if (action !== 'accept' && action !== 'cancel') {
      return NextResponse.json({ error: 'Action must be accept or cancel' }, { status: 422 });
    }
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'External driver assignment not found' }, { status: 404 });
    }

    const db = getDb();
    const tenantId = session.tenantId;
    const [record] = await db
      .select({
        assignment: externalDriverAssignments,
        vehicleId: vehicleAllocations.vehicleId,
        allocationVersion: vehicleAllocations.version,
        allocationStartAt: vehicleAllocations.startAt,
        allocationEndAt: vehicleAllocations.endAt,
        allocationState: vehicleAllocations.state,
        tripStatus: trips.status,
        tripIssuedAt: trips.issuedAt,
        requestReference: transportRequests.reference,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        partyFirstName: externalParties.firstName,
        partyLastName: externalParties.lastName,
        partyOrganisation: externalParties.organisationName,
        partyStatus: externalParties.status,
        licenceStatus: externalDriverLicences.verificationStatus,
        licenceExpiry: externalDriverLicences.expiryDate,
      })
      .from(externalDriverAssignments)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, externalDriverAssignments.allocationId))
      .innerJoin(trips, eq(trips.id, externalDriverAssignments.tripId))
      .innerJoin(transportRequests, eq(transportRequests.id, externalDriverAssignments.requestId))
      .leftJoin(
        tripAuthorities,
        and(
          eq(tripAuthorities.tripId, trips.id),
          eq(tripAuthorities.tenantId, tenantId),
        ),
      )
      .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
      .innerJoin(externalDriverLicences, eq(externalDriverLicences.id, externalDriverAssignments.licenceId))
      .where(
        and(
          eq(externalDriverAssignments.id, id),
          eq(externalDriverAssignments.tenantId, tenantId),
          eq(trips.tenantId, tenantId),
          eq(transportRequests.tenantId, tenantId),
          eq(externalParties.tenantId, tenantId),
          eq(externalDriverLicences.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!record) return NextResponse.json({ error: 'External driver assignment not found' }, { status: 404 });
    if (record.assignment.state !== 'pending_acceptance') {
      return NextResponse.json(
        { error: `Assignment decision is no longer pending (state: ${record.assignment.state})` },
        { status: 409 },
      );
    }
    if (
      record.tripStatus !== 'pending' ||
      record.tripIssuedAt ||
      !['provisional', 'confirmed'].includes(record.allocationState)
    ) {
      return NextResponse.json(
        { error: 'External driver acceptance can only be decided before physical vehicle issue or trip departure' },
        { status: 409 },
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const allocationEndDate = record.allocationEndAt.toISOString().slice(0, 10);
    const driverName = `${record.partyFirstName} ${record.partyLastName}`.trim();

    if (action === 'cancel') {
      const reason = String(body.reason || '').trim();
      if (reason.length < 3) {
        return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 422 });
      }

      // Claim the exact allocation version first. A concurrent vehicle
      // replacement must therefore win or lose before this cancellation can
      // change driver evidence or release the request.
      await db.execute(sql`
        WITH allocation_claim AS (
          UPDATE vehicle_allocations
          SET state = 'cancelled',
              override_reason = ${reason},
              version = version + 1,
              updated_at = ${nowIso}::timestamptz
          WHERE id = ${record.assignment.allocationId}::uuid
            AND state = ${record.allocationState}
            AND version = ${record.allocationVersion}
            AND vehicle_id = ${record.vehicleId}::uuid
            AND EXISTS (
              SELECT 1
              FROM external_driver_assignments eda
              INNER JOIN trips t ON t.id = eda.trip_id
              WHERE eda.id = ${id}::uuid
                AND eda.tenant_id = ${tenantId}::uuid
                AND eda.allocation_id = vehicle_allocations.id
                AND eda.state = 'pending_acceptance'
                AND eda.issue_id IS NULL
                AND t.tenant_id = ${tenantId}::uuid
                AND t.status = 'pending'
                AND t.issued_at IS NULL
                AND t.vehicle_id = vehicle_allocations.vehicle_id
            )
          RETURNING id
        ),
        assignment_claim AS (
          UPDATE external_driver_assignments
          SET state = 'cancelled',
              cancelled_at = ${nowIso}::timestamptz,
              cancellation_reason = ${reason},
              cancelled_by_user_id = ${session.user.id},
              updated_at = ${nowIso}::timestamptz
          WHERE id = ${id}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND state = 'pending_acceptance'
            AND issue_id IS NULL
            AND EXISTS (SELECT 1 FROM allocation_claim)
          RETURNING request_id, allocation_id, trip_id
        ),
        request_driver_reset AS (
          UPDATE external_request_drivers
          SET is_confirmed = false, driver_type = 'nominated'
          WHERE request_id = ${record.assignment.requestId}::uuid
            AND EXISTS (SELECT 1 FROM assignment_claim)
          RETURNING id
        ),
        request_claim AS (
          UPDATE transport_requests
          SET status = 'transport_review',
              assigned_driver_external_party_id = NULL,
              assigned_driver_employee_id = NULL,
              updated_at = ${nowIso}::timestamptz
          WHERE id = ${record.assignment.requestId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND assigned_driver_external_party_id = ${record.assignment.externalPartyId}::uuid
            AND EXISTS (SELECT 1 FROM assignment_claim)
          RETURNING id
        ),
        trip_cancel AS (
          UPDATE trips
          SET status = 'cancelled', updated_at = ${nowIso}::timestamptz
          WHERE id = ${record.assignment.tripId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND status = 'pending'
            AND issued_at IS NULL
            AND vehicle_id = ${record.vehicleId}::uuid
            AND allocation_id = ${record.assignment.allocationId}::uuid
            AND EXISTS (SELECT 1 FROM request_claim)
          RETURNING id
        ),
        authority_cancel AS (
          UPDATE trip_authorities
          SET status = 'cancelled',
              cancelled_at = ${nowIso}::timestamptz,
              cancellation_reason = ${reason},
              updated_at = ${nowIso}::timestamptz
          WHERE allocation_id = ${record.assignment.allocationId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND EXISTS (SELECT 1 FROM trip_cancel)
          RETURNING id
        ),
        generated_authority_cancel AS (
          UPDATE generated_documents
          SET status = 'cancelled',
              reason = ${reason},
              updated_at = ${nowIso}::timestamptz
          WHERE tenant_id = ${tenantId}::uuid
            AND entity_type = 'vehicle_allocation'
            AND entity_id = ${record.assignment.allocationId}::uuid
            AND document_type = 'trip_authority'
            AND status IN ('draft', 'issued')
            AND EXISTS (SELECT 1 FROM trip_cancel)
          RETURNING id
        )
        SELECT 1 / (
          (SELECT count(*)::integer FROM allocation_claim) *
          (SELECT count(*)::integer FROM assignment_claim) *
          (SELECT count(*)::integer FROM request_claim) *
          (SELECT count(*)::integer FROM trip_cancel)
        ) AS committed
      `);

      await Promise.allSettled([
        recordAuditEvent({
          tenantId,
          actorUserId: session.user.id,
          action: 'allocation.external_driver_acceptance_cancelled',
          entityType: 'external_driver_assignment',
          entityId: id,
          summary: `Pending external driver assignment for ${driverName} cancelled and resources released: ${reason}`,
          before: {
            state: 'pending_acceptance',
            allocationState: record.allocationState,
            tripStatus: record.tripStatus,
            vehicleId: record.vehicleId,
            authorityStatus: record.authorityStatus,
          },
          after: {
            state: 'cancelled',
            allocationState: 'cancelled',
            tripStatus: 'cancelled',
            requestStatus: 'transport_review',
            tripAuthorityDocumentStatus: record.authorityId ? 'cancelled' : 'not_yet_issued',
            reason,
          },
        }),
        recordTenantRequestActivity({
          tenantId,
          requestId: record.assignment.requestId,
          reference: record.requestReference,
          stage: 'transport_review',
          officeLabel: 'Transport office · driver reallocation required',
        }),
      ]);
      return NextResponse.json({
        success: true,
        state: 'cancelled',
        allocationState: 'cancelled',
        requestStatus: 'transport_review',
        reallocationRequired: true,
      });
    }

    const acceptanceMethod = String(body.acceptanceMethod || '').trim();
    if (!ACCEPTANCE_METHODS.includes(acceptanceMethod as (typeof ACCEPTANCE_METHODS)[number])) {
      return NextResponse.json(
        { error: 'Select how the external driver acceptance was confirmed' },
        { status: 422 },
      );
    }
    if (record.partyStatus !== 'active' || record.licenceStatus !== 'verified') {
      return NextResponse.json(
        { error: 'The external driver or licence is no longer eligible' },
        { status: 409 },
      );
    }
    const expiryAt = new Date(`${record.licenceExpiry}T23:59:59.999Z`);
    if (!Number.isFinite(expiryAt.getTime()) || expiryAt < record.allocationEndAt) {
      return NextResponse.json(
        { error: 'External driver licence no longer covers the full trip period' },
        { status: 409 },
      );
    }

    const note = String(body.note || '').trim().slice(0, 1000) || null;
    await db.execute(sql`
      WITH allocation_claim AS (
        UPDATE vehicle_allocations
        SET version = version + 1,
            updated_at = ${nowIso}::timestamptz
        WHERE id = ${record.assignment.allocationId}::uuid
          AND state = ${record.allocationState}
          AND version = ${record.allocationVersion}
          AND vehicle_id = ${record.vehicleId}::uuid
          AND EXISTS (
            SELECT 1
            FROM external_driver_assignments eda
            INNER JOIN trips t ON t.id = eda.trip_id
            WHERE eda.id = ${id}::uuid
              AND eda.tenant_id = ${tenantId}::uuid
              AND eda.allocation_id = vehicle_allocations.id
              AND eda.state = 'pending_acceptance'
              AND eda.issue_id IS NULL
              AND t.tenant_id = ${tenantId}::uuid
              AND t.status = 'pending'
              AND t.issued_at IS NULL
              AND t.vehicle_id = vehicle_allocations.vehicle_id
          )
        RETURNING id
      ),
      assignment_claim AS (
        UPDATE external_driver_assignments
        SET state = 'accepted',
            acceptance_method = ${acceptanceMethod},
            acceptance_note = ${note},
            accepted_at = ${nowIso}::timestamptz,
            accepted_recorded_by_user_id = ${session.user.id},
            updated_at = ${nowIso}::timestamptz
        WHERE id = ${id}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND state = 'pending_acceptance'
          AND issue_id IS NULL
          AND EXISTS (SELECT 1 FROM allocation_claim)
          AND EXISTS (
            SELECT 1
            FROM external_parties ep
            INNER JOIN external_driver_licences edl ON edl.external_party_id = ep.id
            WHERE ep.id = external_driver_assignments.external_party_id
              AND ep.tenant_id = ${tenantId}::uuid
              AND ep.status = 'active'
              AND edl.id = external_driver_assignments.licence_id
              AND edl.tenant_id = ${tenantId}::uuid
              AND edl.verification_status = 'verified'
              AND edl.expiry_date >= ${allocationEndDate}::date
          )
        RETURNING request_id, trip_id, external_party_id
      ),
      request_driver_claim AS (
        UPDATE external_request_drivers
        SET is_confirmed = true, licence_validated = true, driver_type = 'assigned'
        WHERE request_id = ${record.assignment.requestId}::uuid
          AND external_party_id = ${record.assignment.externalPartyId}::uuid
          AND EXISTS (SELECT 1 FROM assignment_claim)
        RETURNING id
      )
      SELECT 1 / (
        (SELECT count(*)::integer FROM allocation_claim) *
        (SELECT count(*)::integer FROM assignment_claim) *
        (SELECT count(*)::integer FROM request_driver_claim)
      ) AS committed
    `);

    await Promise.allSettled([
      recordAuditEvent({
        tenantId,
        actorUserId: session.user.id,
        action: 'allocation.external_driver_acceptance_recorded',
        entityType: 'external_driver_assignment',
        entityId: id,
        summary: `Transport Office recorded ${driverName}'s assignment acceptance via ${acceptanceMethod.replace(/_/g, ' ')}`,
        before: {
          state: 'pending_acceptance',
          authorityStatus: record.authorityStatus ?? 'not_yet_issued',
          vehicleId: record.vehicleId,
          allocationVersion: record.allocationVersion,
        },
        after: {
          state: 'accepted',
          authorityStatus: record.authorityStatus ?? 'not_yet_issued',
          acceptedVehicleId: record.vehicleId,
          allocationVersion: record.allocationVersion + 1,
          acceptanceMethod,
          acceptanceNote: note,
          acceptedAt: nowIso,
          recordedByUserId: session.user.id,
        },
      }),
      recordTenantRequestActivity({
        tenantId,
        requestId: record.assignment.requestId,
        reference: record.requestReference,
        stage: 'external_driver_accepted',
        officeLabel: 'Transport office',
      }),
    ]);

    return NextResponse.json({
      success: true,
      state: 'accepted',
      authorityStatus: record.authorityStatus ?? 'not_yet_issued',
      readyForTransportReview: true,
      acceptedAt: nowIso,
      acceptanceMethod,
      acceptedVehicleId: record.vehicleId,
      driver: { name: driverName, organisation: record.partyOrganisation },
    });
  } catch (error) {
    console.error('[allocations/external/decision] PATCH failed:', error);
    return NextResponse.json(
      {
        error:
          'External driver decision, vehicle assignment, or trip state changed concurrently. Refresh and review the latest assignment before trying again.',
      },
      { status: 409 },
    );
  }
}
