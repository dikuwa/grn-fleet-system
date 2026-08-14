import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { externalRequestDrivers, transportRequests } from '@/db/schema/requests';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { recordAuditEvent } from '@/lib/audit-event';
import { runAtomicMutations } from '@/lib/db-atomic';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

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
        allocationStartAt: vehicleAllocations.startAt,
        allocationEndAt: vehicleAllocations.endAt,
        allocationState: vehicleAllocations.state,
        tripStatus: trips.status,
        requestReference: transportRequests.reference,
        partyFirstName: externalParties.firstName,
        partyLastName: externalParties.lastName,
        partyOrganisation: externalParties.organisationName,
        licenceStatus: externalDriverLicences.verificationStatus,
        licenceExpiry: externalDriverLicences.expiryDate,
      })
      .from(externalDriverAssignments)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, externalDriverAssignments.allocationId))
      .innerJoin(trips, eq(trips.id, externalDriverAssignments.tripId))
      .innerJoin(transportRequests, eq(transportRequests.id, externalDriverAssignments.requestId))
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
    if (record.tripStatus !== 'pending' || !['provisional', 'confirmed'].includes(record.allocationState)) {
      return NextResponse.json(
        { error: 'External driver acceptance can only be recorded before trip departure' },
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
      await runAtomicMutations((tx) => [
        tx
          .update(externalDriverAssignments)
          .set({
            state: 'cancelled',
            cancelledAt: now,
            cancellationReason: reason,
            cancelledByUserId: session.user.id,
            updatedAt: now,
          })
          .where(
            and(
              eq(externalDriverAssignments.id, id),
              eq(externalDriverAssignments.tenantId, tenantId),
              eq(externalDriverAssignments.state, 'pending_acceptance'),
            ),
          ),
        tx
          .update(externalRequestDrivers)
          .set({ isConfirmed: false, driverType: 'nominated' })
          .where(
            and(
              eq(externalRequestDrivers.requestId, record.assignment.requestId),
              eq(externalRequestDrivers.externalPartyId, record.assignment.externalPartyId),
            ),
          ),
        tx
          .update(transportRequests)
          .set({ assignedDriverExternalPartyId: null, updatedAt: now })
          .where(
            and(
              eq(transportRequests.id, record.assignment.requestId),
              eq(transportRequests.tenantId, tenantId),
              eq(transportRequests.assignedDriverExternalPartyId, record.assignment.externalPartyId),
            ),
          ),
      ]);

      await Promise.allSettled([
        recordAuditEvent({
          tenantId,
          actorUserId: session.user.id,
          action: 'allocation.external_driver_acceptance_cancelled',
          entityType: 'external_driver_assignment',
          entityId: id,
          summary: `Pending external driver assignment for ${driverName} cancelled: ${reason}`,
          before: { state: 'pending_acceptance' },
          after: { state: 'cancelled', reason },
        }),
        recordTenantRequestActivity({
          tenantId,
          requestId: record.assignment.requestId,
          reference: record.requestReference,
          stage: 'driver_reallocation_required',
          officeLabel: 'Transport office',
        }),
      ]);
      return NextResponse.json({ success: true, state: 'cancelled', reallocationRequired: true });
    }

    const acceptanceMethod = String(body.acceptanceMethod || '').trim();
    if (!ACCEPTANCE_METHODS.includes(acceptanceMethod as (typeof ACCEPTANCE_METHODS)[number])) {
      return NextResponse.json(
        { error: 'Select how the external driver acceptance was confirmed' },
        { status: 422 },
      );
    }
    if (record.licenceStatus !== 'verified') {
      return NextResponse.json(
        { error: 'The external driver licence is no longer verified' },
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
    await runAtomicMutations((tx) => [
      tx
        .update(externalDriverAssignments)
        .set({
          state: 'accepted',
          acceptanceMethod,
          acceptanceNote: note,
          acceptedAt: now,
          acceptedRecordedByUserId: session.user.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(externalDriverAssignments.id, id),
            eq(externalDriverAssignments.tenantId, tenantId),
            eq(externalDriverAssignments.state, 'pending_acceptance'),
          ),
        ),
      tx
        .update(externalRequestDrivers)
        .set({ isConfirmed: true, licenceValidated: true, driverType: 'assigned' })
        .where(
          and(
            eq(externalRequestDrivers.requestId, record.assignment.requestId),
            eq(externalRequestDrivers.externalPartyId, record.assignment.externalPartyId),
          ),
        ),
      tx
        .update(trips)
        .set({ driverAcknowledgedAt: now, driverAcknowledgedByEmployeeId: null, updatedAt: now })
        .where(
          and(
            eq(trips.id, record.assignment.tripId),
            eq(trips.tenantId, tenantId),
            eq(trips.status, 'pending'),
          ),
        ),
    ]);

    await Promise.allSettled([
      recordAuditEvent({
        tenantId,
        actorUserId: session.user.id,
        action: 'allocation.external_driver_acceptance_recorded',
        entityType: 'external_driver_assignment',
        entityId: id,
        summary: `Transport Office recorded ${driverName}'s trip acceptance via ${acceptanceMethod.replace(/_/g, ' ')}`,
        before: { state: 'pending_acceptance' },
        after: {
          state: 'accepted',
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

    return NextResponse.json({
      success: true,
      state: 'accepted',
      acceptedAt: now.toISOString(),
      acceptanceMethod,
      driver: { name: driverName, organisation: record.partyOrganisation },
    });
  } catch (error) {
    console.error('[allocations/external/decision] PATCH failed:', error);
    return NextResponse.json({ error: 'External driver decision could not be recorded' }, { status: 500 });
  }
}
