import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gt, inArray, lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { vehicles } from '@/db/schema/fleet';
import { externalRequestDrivers, transportRequests } from '@/db/schema/requests';
import { trips, vehicleAllocations } from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { recordAuditEvent } from '@/lib/audit-event';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';
import { runAtomicMutations } from '@/lib/db-atomic';
import { onTripIssued } from '@/lib/document-generator';
import { namibiaLicenceClassCovers } from '@/lib/namibia-licence';
import { createScopedNotifications } from '@/lib/notification-service';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

const ALLOCATABLE_STATUSES = [
  'approved',
  'under_review',
  'transport_review',
  'release_pending',
  'vehicle_allocated',
];
const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;
const LIVE_EXTERNAL_ASSIGNMENT_STATES = ['pending_acceptance', 'accepted'] as const;

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const actionCheck = await requireDashboardAction(session, '/dashboard/allocations', 'create');
    if (actionCheck instanceof NextResponse) return actionCheck;
    const permissionCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const body = (await request.json().catch(() => ({}))) as {
      requestId?: string;
      vehicleId?: string;
      externalDriverPartyId?: string;
      startDate?: string;
      endDate?: string;
      notes?: string;
    };
    const requestId = String(body.requestId || '').trim();
    const vehicleId = String(body.vehicleId || '').trim();
    const externalDriverPartyId = String(body.externalDriverPartyId || '').trim();
    if (!requestId || !vehicleId || !externalDriverPartyId || !body.startDate) {
      return NextResponse.json(
        { error: 'Request, vehicle, external driver and start date are required' },
        { status: 422 },
      );
    }

    const startAt = new Date(body.startDate);
    const endAt = body.endDate
      ? new Date(body.endDate)
      : new Date(startAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
      return NextResponse.json({ error: 'Allocation dates are invalid' }, { status: 422 });
    }

    const db = getDb();
    const tenantId = session.tenantId;
    const [[transportRequest], [vehicle]] = await Promise.all([
      db
        .select({
          id: transportRequests.id,
          reference: transportRequests.reference,
          status: transportRequests.status,
          requesterType: transportRequests.requesterType,
          requesterUserId: transportRequests.requesterUserId,
          externalRequesterId: transportRequests.externalRequesterId,
          preferredDriverExternalPartyId: transportRequests.preferredDriverExternalPartyId,
        })
        .from(transportRequests)
        .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId)))
        .limit(1),
      db
        .select({
          id: vehicles.id,
          licenceNumber: vehicles.licenceNumber,
          status: vehicles.status,
          requiredLicenceClass: vehicles.requiredLicenceClass,
          professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
        })
        .from(vehicles)
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)))
        .limit(1),
    ]);
    if (!transportRequest) return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    if (!ALLOCATABLE_STATUSES.includes(transportRequest.status)) {
      return NextResponse.json(
        { error: `Request cannot be allocated while status is "${transportRequest.status}"` },
        { status: 409 },
      );
    }
    if (transportRequest.requesterType !== 'external') {
      return NextResponse.json(
        { error: 'External-driver allocation is currently limited to external transport requests' },
        { status: 409 },
      );
    }
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    if (vehicle.status !== 'available') {
      return NextResponse.json({ error: `Vehicle is not available (status: ${vehicle.status})` }, { status: 409 });
    }

    const [driverRecord] = await db
      .select({ party: externalParties, licence: externalDriverLicences })
      .from(externalParties)
      .innerJoin(externalDriverLicences, eq(externalDriverLicences.externalPartyId, externalParties.id))
      .where(
        and(
          eq(externalParties.id, externalDriverPartyId),
          eq(externalParties.tenantId, tenantId),
          eq(externalParties.status, 'active'),
          eq(externalDriverLicences.tenantId, tenantId),
          eq(externalDriverLicences.verificationStatus, 'verified'),
        ),
      )
      .orderBy(desc(externalDriverLicences.version))
      .limit(1);
    if (!driverRecord) {
      return NextResponse.json(
        { error: 'External driver has no verified licence evidence' },
        { status: 409 },
      );
    }
    const expiryAt = new Date(`${driverRecord.licence.expiryDate}T23:59:59.999Z`);
    if (!Number.isFinite(expiryAt.getTime()) || expiryAt < endAt) {
      return NextResponse.json(
        { error: 'External driver licence must remain valid through the allocation end date' },
        { status: 409 },
      );
    }
    if (
      vehicle.requiredLicenceClass &&
      !namibiaLicenceClassCovers(driverRecord.licence.licenceClass, vehicle.requiredLicenceClass)
    ) {
      return NextResponse.json(
        { error: 'External driver licence class is not compatible with this vehicle' },
        { status: 409 },
      );
    }
    if (vehicle.professionalAuthorisationRequired) {
      return NextResponse.json(
        {
          error:
            'This vehicle requires professional driving authorisation. Verified external professional-authorisation evidence must be added before this driver can be assigned.',
        },
        { status: 409 },
      );
    }

    const [[vehicleConflict], [externalDriverConflict]] = await Promise.all([
      db
        .select({ id: vehicleAllocations.id })
        .from(vehicleAllocations)
        .where(
          and(
            eq(vehicleAllocations.vehicleId, vehicleId),
            inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
            lt(vehicleAllocations.startAt, endAt),
            gt(vehicleAllocations.endAt, startAt),
          ),
        )
        .limit(1),
      db
        .select({ id: externalDriverAssignments.id })
        .from(externalDriverAssignments)
        .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, externalDriverAssignments.allocationId))
        .where(
          and(
            eq(externalDriverAssignments.tenantId, tenantId),
            eq(externalDriverAssignments.externalPartyId, externalDriverPartyId),
            inArray(externalDriverAssignments.state, [...LIVE_EXTERNAL_ASSIGNMENT_STATES]),
            lt(vehicleAllocations.startAt, endAt),
            gt(vehicleAllocations.endAt, startAt),
          ),
        )
        .limit(1),
    ]);
    if (vehicleConflict) {
      return NextResponse.json({ error: 'Vehicle is already allocated during this period' }, { status: 409 });
    }
    if (externalDriverConflict) {
      return NextResponse.json({ error: 'External driver already has an overlapping live assignment' }, { status: 409 });
    }

    const [nominatedDrivers, [existingNomination], [externalRequester]] = await Promise.all([
      db
        .select({ externalPartyId: externalRequestDrivers.externalPartyId })
        .from(externalRequestDrivers)
        .where(
          and(
            eq(externalRequestDrivers.requestId, requestId),
            eq(externalRequestDrivers.driverType, 'nominated'),
          ),
        ),
      db
        .select({ id: externalRequestDrivers.id })
        .from(externalRequestDrivers)
        .where(
          and(
            eq(externalRequestDrivers.requestId, requestId),
            eq(externalRequestDrivers.externalPartyId, externalDriverPartyId),
          ),
        )
        .limit(1),
      transportRequest.externalRequesterId
        ? db
            .select({
              id: externalParties.id,
              firstName: externalParties.firstName,
              lastName: externalParties.lastName,
              email: externalParties.email,
            })
            .from(externalParties)
            .where(
              and(
                eq(externalParties.id, transportRequest.externalRequesterId),
                eq(externalParties.tenantId, tenantId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
    ]);

    const requesterNominatedDriverIds = Array.from(
      new Set(nominatedDrivers.map((driver) => driver.externalPartyId).filter(Boolean)),
    );
    if (
      transportRequest.preferredDriverExternalPartyId &&
      !requesterNominatedDriverIds.includes(transportRequest.preferredDriverExternalPartyId)
    ) {
      requesterNominatedDriverIds.push(transportRequest.preferredDriverExternalPartyId);
    }
    const driverNominationOverridden = Boolean(
      requesterNominatedDriverIds.length > 0 &&
        !requesterNominatedDriverIds.includes(externalDriverPartyId),
    );
    const assignmentNote = body.notes?.trim() || '';
    if (driverNominationOverridden && assignmentNote.length < 3) {
      return NextResponse.json(
        {
          error:
            'The requester nominated a different external driver. Add a clear override reason in the Transport note before assigning another driver.',
          requiresDriverOverrideReason: true,
          nominatedExternalDriverPartyIds: requesterNominatedDriverIds,
        },
        { status: 400 },
      );
    }

    const allocationId = randomUUID();
    const tripId = randomUUID();
    const assignmentId = randomUUID();
    const now = new Date();
    const licenceSnapshot = {
      licenceId: driverRecord.licence.id,
      licenceNumber: driverRecord.licence.licenceNumber,
      licenceClass: driverRecord.licence.licenceClass,
      issueDate: driverRecord.licence.issueDate,
      expiryDate: driverRecord.licence.expiryDate,
      verificationStatus: driverRecord.licence.verificationStatus,
      verifiedAt: driverRecord.licence.verifiedAt?.toISOString() || null,
      externalDriverName: `${driverRecord.party.firstName} ${driverRecord.party.lastName}`.trim(),
      organisationName: driverRecord.party.organisationName,
    };

    await runAtomicMutations((tx) => {
      const mutations: Array<PromiseLike<unknown>> = [
        tx.insert(vehicleAllocations).values({
          id: allocationId,
          requestId,
          vehicleId,
          driverEmployeeId: null,
          startAt,
          endAt,
          state: 'confirmed',
          allocatedByUserId: session.user.id,
          overrideReason: assignmentNote || null,
          createdAt: now,
          updatedAt: now,
        }),
        tx.insert(trips).values({
          id: tripId,
          tenantId,
          requestId,
          allocationId,
          vehicleId,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        }),
        tx.insert(externalDriverAssignments).values({
          id: assignmentId,
          tenantId,
          requestId,
          allocationId,
          tripId,
          externalPartyId: externalDriverPartyId,
          licenceId: driverRecord.licence.id,
          state: 'pending_acceptance',
          driverType: 'assigned',
          licenceSnapshot,
          assignedByUserId: session.user.id,
          assignedAt: now,
          createdAt: now,
          updatedAt: now,
        }),
        tx
          .update(transportRequests)
          .set({
            assignedDriverEmployeeId: null,
            assignedDriverExternalPartyId: externalDriverPartyId,
            status: 'vehicle_allocated',
            updatedAt: now,
          })
          .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId))),
        tx
          .update(externalRequestDrivers)
          .set({ isConfirmed: false, driverType: 'nominated' })
          .where(eq(externalRequestDrivers.requestId, requestId)),
      ];
      if (existingNomination) {
        mutations.push(
          tx
            .update(externalRequestDrivers)
            .set({ isConfirmed: true, licenceValidated: true, driverType: 'assigned' })
            .where(eq(externalRequestDrivers.id, existingNomination.id)),
        );
      } else {
        mutations.push(
          tx.insert(externalRequestDrivers).values({
            requestId,
            externalPartyId: externalDriverPartyId,
            driverType: 'assigned',
            sortOrder: 1,
            isConfirmed: true,
            licenceValidated: true,
          }),
        );
      }
      return mutations;
    });

    const [[allocation], [trip], [assignment]] = await Promise.all([
      db.select().from(vehicleAllocations).where(eq(vehicleAllocations.id, allocationId)).limit(1),
      db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId))).limit(1),
      db
        .select()
        .from(externalDriverAssignments)
        .where(and(eq(externalDriverAssignments.id, assignmentId), eq(externalDriverAssignments.tenantId, tenantId)))
        .limit(1),
    ]);
    if (!allocation || !trip || !assignment) {
      throw new Error('External allocation committed but created records could not be reloaded');
    }

    let documentId: string | null = null;
    try {
      const document = await onTripIssued(allocationId, tenantId, session.user.id);
      documentId = document?.id || null;
    } catch (documentError) {
      console.warn('[allocations/external] post-commit document generation failed:', documentError);
    }

    await Promise.allSettled([
      recordAuditEvent({
        tenantId,
        actorUserId: session.user.id,
        action: 'allocation.external_driver_assigned',
        entityType: 'allocation',
        entityId: allocationId,
        summary: `External driver assigned to ${transportRequest.reference} for vehicle ${vehicle.licenceNumber}; acceptance pending`,
        before: { requesterNominatedExternalDriverPartyIds: requesterNominatedDriverIds },
        after: {
          requestId,
          vehicleId,
          externalDriverPartyId,
          externalDriverAssignmentId: assignmentId,
          licenceId: driverRecord.licence.id,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          assignmentNote: assignmentNote || null,
          driverNominationOverridden,
          driverOverrideReason: driverNominationOverridden ? assignmentNote : null,
          documentId,
        },
      }),
      driverNominationOverridden
        ? recordAuditEvent({
            tenantId,
            actorUserId: session.user.id,
            action: 'allocation.external_driver_nomination_overridden',
            entityType: 'allocation',
            entityId: allocationId,
            summary: `Requester external-driver nomination overridden for ${transportRequest.reference}.`,
            before: { nominatedExternalDriverPartyIds: requesterNominatedDriverIds },
            after: { assignedExternalDriverPartyId: externalDriverPartyId, reason: assignmentNote },
          })
        : Promise.resolve(),
      recordTenantRequestActivity({
        tenantId,
        requestId,
        reference: transportRequest.reference,
        stage: 'allocated',
        officeLabel: 'Transport office',
      }),
    ]);

    if (driverNominationOverridden && transportRequest.requesterUserId) {
      await createScopedNotifications({
        tenantId,
        recipientUserIds: [transportRequest.requesterUserId],
        category: 'awareness',
        eventType: 'external_driver.nomination_overridden',
        title: 'External driver nomination updated',
        body: `Transport Office assigned a different verified external driver to ${transportRequest.reference}. Reason: ${assignmentNote}`,
        entityType: 'allocation',
        entityId: allocationId,
        actionUrl: `/dashboard/requests/${requestId}`,
      }).catch((notificationError) =>
        console.warn('[allocations/external] requester override notification failed:', notificationError),
      );
    }

    if (driverNominationOverridden && externalRequester?.email) {
      try {
        const { sendNotificationEmail } = await import('@/lib/email');
        await sendNotificationEmail({
          to: externalRequester.email,
          type: 'allocation_created',
          title: 'Vehicle and external driver allocated',
          body: `Transport Office assigned a different verified external driver to request ${transportRequest.reference}. Reason: ${assignmentNote}`,
          actionUrl: `/dashboard/requests/${requestId}`,
          recipientName:
            `${externalRequester.firstName || ''} ${externalRequester.lastName || ''}`.trim() ||
            'Requester',
        });
      } catch (emailError) {
        console.warn('[allocations/external] external requester override email failed:', emailError);
      }
    }

    return NextResponse.json(
      {
        success: true,
        allocation,
        trip,
        externalDriverAssignment: assignment,
        acceptanceRequired: true,
        driverNominationOverridden,
        documentId,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[allocations/external] POST failed:', error);
    const { code, message } = getDatabaseErrorDetails(error);
    if (
      code === '23P01' ||
      message.includes('allocation_vehicle_overlap') ||
      message.includes('allocation_request_already_live') ||
      message.includes('external_driver_assignment_overlap')
    ) {
      return NextResponse.json(
        {
          error:
            'The vehicle, request, or external driver was allocated by another operation at the same time. Refresh and choose currently available resources.',
        },
        { status: 409 },
      );
    }
    if (code === '23514' && message.includes('external_driver_assignment_')) {
      return NextResponse.json(
        { error: 'The external driver assignment no longer matches the current trip lifecycle. Refresh and try again.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'External driver allocation could not be created' }, { status: 500 });
  }
}
