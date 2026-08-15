import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { transportRequests } from '@/db/schema/requests';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { recordAuditEvent } from '@/lib/audit-event';
import {
  createScopedNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { SystemRoles } from '@/lib/workspaces';

const ACCEPTANCE_METHODS = ['in_person', 'phone', 'signed_paper', 'secure_link'] as const;

type RouteContext = { params: Promise<{ id: string }> };

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

    const db = getDb();
    const tenantId = session.tenantId;
    const [record] = await db
      .select({
        assignment: externalDriverAssignments,
        vehicleId: vehicleAllocations.vehicleId,
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
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
      .innerJoin(externalDriverLicences, eq(externalDriverLicences.id, externalDriverAssignments.licenceId))
      .where(
        and(
          eq(externalDriverAssignments.id, id),
          eq(externalDriverAssignments.tenantId, tenantId),
          eq(trips.tenantId, tenantId),
          eq(transportRequests.tenantId, tenantId),
          eq(tripAuthorities.tenantId, tenantId),
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
    const driverName = `${record.partyFirstName} ${record.partyLastName}`.trim();

    if (action === 'cancel') {
      const reason = String(body.reason || '').trim();
      if (reason.length < 3) {
        return NextResponse.json({ error: 'A cancellation reason is required' }, { status: 422 });
      }

      await db.execute(sql`
        WITH assignment_claim AS (
          UPDATE external_driver_assignments
          SET state = 'cancelled',
              cancelled_at = ${now},
              cancellation_reason = ${reason},
              cancelled_by_user_id = ${session.user.id},
              updated_at = ${now}
          WHERE id = ${id}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND state = 'pending_acceptance'
            AND issue_id IS NULL
            AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = external_driver_assignments.trip_id
                AND t.tenant_id = ${tenantId}::uuid
                AND t.status = 'pending'
                AND t.issued_at IS NULL
            )
            AND EXISTS (
              SELECT 1 FROM vehicle_allocations va
              WHERE va.id = external_driver_assignments.allocation_id
                AND va.state IN ('provisional', 'confirmed')
            )
          RETURNING request_id, allocation_id, trip_id
        ),
        allocation_cancel AS (
          UPDATE vehicle_allocations
          SET state = 'cancelled', override_reason = ${reason}, updated_at = ${now}
          WHERE id = ${record.assignment.allocationId}::uuid
            AND state IN ('provisional', 'confirmed')
            AND EXISTS (SELECT 1 FROM assignment_claim)
          RETURNING id
        ),
        request_driver_reset AS (
          UPDATE external_request_drivers
          SET is_confirmed = false, driver_type = 'nominated'
          WHERE request_id = ${record.assignment.requestId}::uuid
            AND EXISTS (SELECT 1 FROM allocation_cancel)
          RETURNING id
        ),
        request_claim AS (
          UPDATE transport_requests
          SET status = 'transport_review',
              assigned_driver_external_party_id = NULL,
              assigned_driver_employee_id = NULL,
              updated_at = ${now}
          WHERE id = ${record.assignment.requestId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND EXISTS (SELECT 1 FROM allocation_cancel)
          RETURNING id
        ),
        trip_cancel AS (
          UPDATE trips
          SET status = 'cancelled', updated_at = ${now}
          WHERE id = ${record.assignment.tripId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND status = 'pending'
            AND issued_at IS NULL
            AND EXISTS (SELECT 1 FROM request_claim)
          RETURNING id
        ),
        authority_cancel AS (
          UPDATE trip_authorities
          SET status = 'cancelled',
              cancelled_at = ${now},
              cancellation_reason = ${reason},
              updated_at = ${now}
          WHERE allocation_id = ${record.assignment.allocationId}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND EXISTS (SELECT 1 FROM trip_cancel)
          RETURNING id
        ),
        generated_authority_cancel AS (
          UPDATE generated_documents
          SET status = 'cancelled',
              reason = ${reason},
              updated_at = ${now}
          WHERE tenant_id = ${tenantId}::uuid
            AND entity_type = 'vehicle_allocation'
            AND entity_id = ${record.assignment.allocationId}::uuid
            AND document_type = 'trip_authority'
            AND status IN ('draft', 'issued')
            AND EXISTS (SELECT 1 FROM trip_cancel)
          RETURNING id
        )
        SELECT CAST(CASE
          WHEN (SELECT count(*) FROM assignment_claim) = 1
           AND (SELECT count(*) FROM allocation_cancel) = 1
           AND (SELECT count(*) FROM request_claim) = 1
           AND (SELECT count(*) FROM trip_cancel) = 1
          THEN '1'
          ELSE 'atomic_external_driver_cancel_failed_' || (SELECT count(*) FROM assignment_claim)::text
        END AS integer) AS committed
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
          },
          after: {
            state: 'cancelled',
            allocationState: 'cancelled',
            tripStatus: 'cancelled',
            requestStatus: 'transport_review',
            tripAuthorityDocumentStatus: 'cancelled',
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
    if (record.authorityStatus !== 'awaiting_driver_acceptance') {
      return NextResponse.json(
        { error: `Trip Authority cannot be accepted from "${record.authorityStatus}"` },
        { status: 409 },
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
      WITH assignment_claim AS (
        UPDATE external_driver_assignments
        SET state = 'accepted',
            acceptance_method = ${acceptanceMethod},
            acceptance_note = ${note},
            accepted_at = ${now},
            accepted_recorded_by_user_id = ${session.user.id},
            updated_at = ${now}
        WHERE id = ${id}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND state = 'pending_acceptance'
          AND issue_id IS NULL
          AND EXISTS (
            SELECT 1 FROM trips t
            WHERE t.id = external_driver_assignments.trip_id
              AND t.tenant_id = ${tenantId}::uuid
              AND t.status = 'pending'
              AND t.issued_at IS NULL
          )
          AND EXISTS (
            SELECT 1 FROM vehicle_allocations va
            WHERE va.id = external_driver_assignments.allocation_id
              AND va.state IN ('provisional', 'confirmed')
              AND va.end_at <= (${record.allocationEndAt})
          )
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
              AND edl.expiry_date >= ${record.allocationEndAt}::date
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
      ),
      authority_claim AS (
        UPDATE trip_authorities
        SET status = 'driver_accepted',
            accepted_at = ${now},
            accepted_by_employee_id = NULL,
            acceptance_data = jsonb_build_object(
              'source', 'transport_office_external',
              'externalDriverAssignmentId', ${id}::text,
              'externalPartyId', ${record.assignment.externalPartyId}::text,
              'acceptanceMethod', ${acceptanceMethod},
              'acceptanceNote', ${note},
              'acceptedAt', ${now}::text,
              'recordedByUserId', ${session.user.id}
            ),
            updated_at = ${now}
        WHERE id = ${record.authorityId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND trip_id = ${record.assignment.tripId}::uuid
          AND status = 'awaiting_driver_acceptance'
          AND EXISTS (SELECT 1 FROM assignment_claim)
        RETURNING id
      ),
      trip_ack AS (
        UPDATE trips
        SET driver_acknowledged_at = ${now},
            driver_acknowledged_by_employee_id = NULL,
            updated_at = ${now}
        WHERE id = ${record.assignment.tripId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = 'pending'
          AND issued_at IS NULL
          AND EXISTS (SELECT 1 FROM authority_claim)
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM assignment_claim) = 1
         AND (SELECT count(*) FROM request_driver_claim) = 1
         AND (SELECT count(*) FROM authority_claim) = 1
         AND (SELECT count(*) FROM trip_ack) = 1
        THEN '1'
        ELSE 'atomic_external_driver_accept_failed_' || (SELECT count(*) FROM assignment_claim)::text
      END AS integer) AS committed
    `);

    await Promise.allSettled([
      recordAuditEvent({
        tenantId,
        actorUserId: session.user.id,
        action: 'allocation.external_driver_acceptance_recorded',
        entityType: 'external_driver_assignment',
        entityId: id,
        summary: `Transport Office recorded ${driverName}'s trip acceptance via ${acceptanceMethod.replace(/_/g, ' ')}`,
        before: { state: 'pending_acceptance', authorityStatus: record.authorityStatus },
        after: {
          state: 'accepted',
          authorityStatus: 'driver_accepted',
          acceptanceMethod,
          acceptanceNote: note,
          acceptedAt: now.toISOString(),
          recordedByUserId: session.user.id,
        },
      }),
      recordTenantRequestActivity({
        tenantId,
        requestId: record.assignment.requestId,
        reference: record.requestReference,
        stage: 'driver_accepted',
        officeLabel: 'Transport office',
      }),
    ]);

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
        title: 'Departure inspection required',
        body: `External driver acceptance has been recorded for ${record.requestReference}. Complete the official departure inspection before the vehicle can be issued.`,
        entityType: 'trip',
        entityId: record.assignment.tripId,
        actionUrl: `/dashboard/inspections/new?type=departure&tripId=${record.assignment.tripId}&vehicleId=${record.vehicleId}`,
        workspace: null,
        priority: 'high',
      }).catch((error) =>
        console.warn('[allocations/external/decision] Inspection notification failed:', error),
      );
    }

    return NextResponse.json({
      success: true,
      state: 'accepted',
      authorityStatus: 'driver_accepted',
      acceptedAt: now.toISOString(),
      acceptanceMethod,
      driver: { name: driverName, organisation: record.partyOrganisation },
    });
  } catch (error) {
    console.error('[allocations/external/decision] PATCH failed:', error);
    return NextResponse.json(
      { error: 'External driver decision changed concurrently or could not be recorded. Refresh and try again.' },
      { status: 409 },
    );
  }
}
