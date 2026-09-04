import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getDb } from '@/db';
import {
  trips,
  tripAuthorities,
  tripClosures,
  fuelReceipts,
  fuelTransactions,
  tripExpenses,
  tripIncidents,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles, vehicleStatusEvents, vehicleDefects } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';
import { Permissions } from '@/lib/permissions';
import { onTripClosed } from '@/lib/document-generator';
import { eq, and, desc, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { runAtomicMutations } from '@/lib/db-atomic';

const CLOSURE_DECISIONS = ['closed', 'requires_correction', 'follow_up'] as const;
type ClosureDecision = (typeof CLOSURE_DECISIONS)[number];
const RESTRICTED_VEHICLE_STATUSES = new Set(['maintenance', 'out_of_service', 'written_off']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReturnDeclaration = {
  incidentDeclared?: boolean;
  outstandingReceiptsDeclared?: boolean;
  reconciledAt?: string | null;
};

function readReturnDeclaration(data: Record<string, unknown> | null | undefined): ReturnDeclaration | null {
  const value = data?.returnDeclaration;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as ReturnDeclaration;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const decision: ClosureDecision = body.decision || 'closed';
    const reviewNotes = typeof body.reviewNotes === 'string' ? body.reviewNotes.trim() : '';

    if (!CLOSURE_DECISIONS.includes(decision)) {
      return NextResponse.json(
        { error: 'decision must be: closed, requires_correction, or follow_up' },
        { status: 400 },
      );
    }
    if (reviewNotes.length > 2000) {
      return NextResponse.json({ error: 'Review notes must be 2000 characters or fewer' }, { status: 422 });
    }
    if ((decision === 'requires_correction' || decision === 'follow_up') && !reviewNotes) {
      return NextResponse.json({ error: 'Review notes are required when returning a trip for correction or follow-up' }, { status: 422 });
    }

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips/closure-review', 'approve');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.TRIP_CLOSE);
    if (permCheck instanceof NextResponse) return permCheck;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Trip ID is invalid' }, { status: 400 });
    }

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    const [trip] = await db
      .select({
        id: trips.id,
        requestId: trips.requestId,
        allocationId: trips.allocationId,
        vehicleId: trips.vehicleId,
        status: trips.status,
      })
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.tenantId, tenantId)))
      .limit(1);

    if (!trip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    if (trip.status === 'closed') return NextResponse.json({ error: 'Trip is already closed' }, { status: 409 });
    if (!['return_inspection', 'closure_review'].includes(trip.status)) {
      return NextResponse.json(
        { error: `Trip status "${trip.status}" must be "return_inspection" or "closure_review" before closing.` },
        { status: 409 },
      );
    }

    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        vehicleId: vehicleAllocations.vehicleId,
        replacedFromVehicleId: vehicleAllocations.replacedFromVehicleId,
      })
      .from(vehicleAllocations)
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(and(
        eq(vehicleAllocations.id, trip.allocationId),
        eq(transportRequests.tenantId, tenantId),
      ))
      .limit(1);
    if (!allocation) return NextResponse.json({ error: 'Trip allocation not found' }, { status: 409 });
    if (!['provisional', 'confirmed'].includes(allocation.state)) {
      return NextResponse.json({ error: `Allocation is already ${allocation.state}` }, { status: 409 });
    }

    const [authority] = await db.select()
      .from(tripAuthorities)
      .where(and(eq(tripAuthorities.tripId, id), eq(tripAuthorities.tenantId, tenantId)))
      .limit(1);
    if (!authority) return NextResponse.json({ error: 'Trip Authority not found' }, { status: 409 });

    if (decision === 'requires_correction' || decision === 'follow_up') {
      const now = new Date();
      const action = decision === 'follow_up' ? 'request_follow_up' : 'request_correction';
      const summary = decision === 'follow_up'
        ? 'Trip reconciliation marked for follow-up'
        : 'Trip reconciliation returned for correction';

      await db.execute(sql`
        WITH trip_claim AS (
          UPDATE trips
          SET status = 'closure_review', updated_at = ${now}
          WHERE id = ${id}::uuid
            AND tenant_id = ${tenantId}::uuid
            AND status IN ('return_inspection', 'closure_review')
          RETURNING id
        ),
        audit_insert AS (
          INSERT INTO audit_events (
            tenant_id, tenant_sequence, event_type, actor_user_id, action,
            entity_type, entity_id, summary, reason, source_channel
          )
          SELECT
            ${tenantId}::uuid,
            ${Date.now()},
            'trip_reconciliation_returned',
            ${userId},
            ${action},
            'trip',
            ${id}::uuid,
            ${summary},
            ${reviewNotes},
            'web'
          FROM trip_claim
          RETURNING id
        )
        SELECT CASE
          WHEN (SELECT count(*) FROM trip_claim) = 1
           AND (SELECT count(*) FROM audit_insert) = 1
          THEN 1
          ELSE CAST('closure_decision_conflict' AS integer)
        END AS committed
      `);

      const [updatedTrip] = await db.select().from(trips)
        .where(and(eq(trips.id, id), eq(trips.tenantId, tenantId))).limit(1);
      return NextResponse.json({
        trip: updatedTrip,
        correctionRequired: decision === 'requires_correction',
        followUpRequired: decision === 'follow_up',
      });
    }

    const returnDeclaration = readReturnDeclaration(authority.data);
    const incidentDeclared = returnDeclaration?.incidentDeclared === true;
    const receiptsDeclared = returnDeclaration?.outstandingReceiptsDeclared === true;
    if ((incidentDeclared || receiptsDeclared) && !returnDeclaration?.reconciledAt) {
      return NextResponse.json(
        { error: 'Return declarations must be reconciled before this trip can be closed.' },
        { status: 409 },
      );
    }

    const [arrivalInspection] = await db.select({
      id: vehicleInspections.id,
      status: vehicleInspections.status,
    })
      .from(vehicleInspections)
      .where(and(
        eq(vehicleInspections.tripId, id),
        eq(vehicleInspections.tenantId, tenantId),
        eq(vehicleInspections.vehicleId, trip.vehicleId),
        eq(vehicleInspections.type, 'return'),
      ))
      .orderBy(desc(vehicleInspections.createdAt), desc(vehicleInspections.id))
      .limit(1);
    if (!arrivalInspection || !['completed', 'failed'].includes(arrivalInspection.status)) {
      return NextResponse.json(
        {
          error: arrivalInspection
            ? `The latest arrival inspection is still ${arrivalInspection.status.replaceAll('_', ' ')}. Submit it before reconciliation can close.`
            : 'A submitted arrival inspection for the currently allocated vehicle is required before reconciliation can close',
        },
        { status: 409 },
      );
    }

    const [outstandingFuel] = await db
      .select({ count: sql<number>`count(*)` })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(
        eq(fuelTransactions.tripId, id),
        eq(vehicles.tenantId, tenantId),
        eq(fuelTransactions.isVerified, false),
      ));
    const [outstandingExpenses] = await db
      .select({ count: sql<number>`count(*)` })
      .from(tripExpenses)
      .where(and(
        eq(tripExpenses.tripId, id),
        eq(tripExpenses.tenantId, tenantId),
        ne(tripExpenses.verificationStatus, 'verified'),
      ));
    const [[unsafeIncident], [anyIncident], [fuelReceiptEvidence], [expenseReceiptEvidence]] = await Promise.all([
      db
        .select({ id: tripIncidents.id })
        .from(tripIncidents)
        .where(and(
          eq(tripIncidents.tripId, id),
          eq(tripIncidents.tenantId, tenantId),
          or(
            eq(tripIncidents.safeToContinue, false),
            eq(tripIncidents.vehicleSafe, false),
            eq(tripIncidents.vehicleDamage, true),
            eq(tripIncidents.severity, 'critical'),
          ),
          or(
            ne(tripIncidents.status, 'resolved'),
            ne(tripIncidents.technicalClearanceStatus, 'cleared'),
          ),
        ))
        .limit(1),
      db
        .select({ id: tripIncidents.id })
        .from(tripIncidents)
        .where(and(eq(tripIncidents.tripId, id), eq(tripIncidents.tenantId, tenantId)))
        .limit(1),
      db
        .select({ id: fuelReceipts.id })
        .from(fuelReceipts)
        .innerJoin(fuelTransactions, eq(fuelTransactions.id, fuelReceipts.transactionId))
        .innerJoin(vehicles, eq(vehicles.id, fuelTransactions.vehicleId))
        .where(
          and(
            eq(fuelTransactions.tripId, id),
            eq(vehicles.tenantId, tenantId),
            sql`(${fuelReceipts.tenantId} is null or ${fuelReceipts.tenantId} = ${tenantId}::uuid)`,
          ),
        )
        .limit(1),
      db
        .select({ id: tripExpenses.id })
        .from(tripExpenses)
        .where(
          and(
            eq(tripExpenses.tripId, id),
            eq(tripExpenses.tenantId, tenantId),
            sql`${tripExpenses.receiptKey} is not null and length(trim(${tripExpenses.receiptKey})) > 0`,
          ),
        )
        .limit(1),
    ]);

    if (Number(outstandingFuel?.count ?? 0) > 0 || Number(outstandingExpenses?.count ?? 0) > 0) {
      return NextResponse.json({ error: 'All fuel and expense transactions must be verified before closure' }, { status: 409 });
    }
    if (incidentDeclared && !anyIncident) {
      return NextResponse.json(
        { error: 'An incident was declared at return, but no incident record exists for this trip.' },
        { status: 409 },
      );
    }
    if (returnDeclaration && !incidentDeclared && anyIncident && !returnDeclaration.reconciledAt) {
      return NextResponse.json(
        {
          error:
            'Incident evidence exists for this trip but the return declaration recorded no incident. Reconcile the declaration evidence before closure.',
        },
        { status: 409 },
      );
    }
    if (receiptsDeclared && !fuelReceiptEvidence && !expenseReceiptEvidence) {
      return NextResponse.json(
        { error: 'Outstanding receipts were declared at return, but no receipt evidence exists for this trip.' },
        { status: 409 },
      );
    }
    if (unsafeIncident) {
      return NextResponse.json(
        { error: 'A vehicle-safety incident remains unresolved or still requires technical clearance.' },
        { status: 409 },
      );
    }
    if (!['awaiting_reconciliation', 'completed'].includes(authority.status)) {
      return NextResponse.json({ error: `Trip Authority is not ready for reconciliation (${authority.status})` }, { status: 409 });
    }

    const fuel = await db
      .select({ litres: fuelTransactions.litres, amount: fuelTransactions.amount })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(eq(fuelTransactions.tripId, id), eq(vehicles.tenantId, tenantId)));
    const totalFuelLitres = fuel.reduce((sum, row) => sum + Number(row.litres), 0);
    const totalFuelCost = fuel.reduce((sum, row) => sum + Number(row.amount), 0);

    const hadReplacement = allocation.replacedFromVehicleId != null;
    let vehicleOdometerReadings: Record<string, { start: number; end: number }> = {};
    let actualKilometres: number | null = null;
    let kilometreVariance: number | null = null;

    if (hadReplacement) {
      const perVehicle = body.vehicleOdometerReadings;
      if (!perVehicle || typeof perVehicle !== 'object' || Array.isArray(perVehicle)) {
        return NextResponse.json({ error: 'This trip had a vehicle replacement. Per-vehicle odometer readings are required.' }, { status: 400 });
      }
      const expectedVehicleIds = [allocation.replacedFromVehicleId, allocation.vehicleId]
        .filter((value): value is string => Boolean(value));
      for (const expectedId of expectedVehicleIds) {
        if (!(expectedId in perVehicle)) {
          return NextResponse.json({ error: `Odometer readings are required for vehicle ${expectedId}` }, { status: 400 });
        }
      }
      for (const [vehicleId, readings] of Object.entries(perVehicle)) {
        if (!expectedVehicleIds.includes(vehicleId)) {
          return NextResponse.json({ error: `Unexpected vehicle ${vehicleId} in odometer readings` }, { status: 400 });
        }
        const value = readings as { start?: unknown; end?: unknown };
        if (
          typeof value.start !== 'number' ||
          typeof value.end !== 'number' ||
          !Number.isFinite(value.start) ||
          !Number.isFinite(value.end)
        ) {
          return NextResponse.json({ error: `Invalid odometer readings for vehicle ${vehicleId}: start and end must be finite numbers` }, { status: 400 });
        }
        if (value.end < value.start) {
          return NextResponse.json({ error: `Odometer end (${value.end}) cannot be less than start (${value.start}) for vehicle ${vehicleId}` }, { status: 400 });
        }
      }
      vehicleOdometerReadings = perVehicle as Record<string, { start: number; end: number }>;
      actualKilometres = Object.values(vehicleOdometerReadings)
        .reduce((sum, readings) => sum + (readings.end - readings.start), 0);
      if (body.authorisedKm != null) kilometreVariance = actualKilometres - Number(body.authorisedKm);
    } else {
      actualKilometres = authority.beginningOdometer !== null && authority.endingOdometer !== null
        ? authority.endingOdometer - authority.beginningOdometer
        : body.actualKm != null ? Number(body.actualKm) : null;
      if (actualKilometres != null && (!Number.isFinite(actualKilometres) || actualKilometres < 0)) {
        return NextResponse.json({ error: 'Actual kilometres must be a non-negative number' }, { status: 400 });
      }
      kilometreVariance = body.authorisedKm != null && actualKilometres != null
        ? actualKilometres - Number(body.authorisedKm)
        : null;
    }

    const authorisedKilometres = body.authorisedKm != null ? Number(body.authorisedKm) : null;
    if (authorisedKilometres != null && (!Number.isFinite(authorisedKilometres) || authorisedKilometres < 0)) {
      return NextResponse.json({ error: 'Authorised kilometres must be a non-negative number' }, { status: 400 });
    }

    const [[currentVehicle], [blockingDefect]] = await Promise.all([
      db
        .select({ status: vehicles.status })
        .from(vehicles)
        .where(and(eq(vehicles.id, trip.vehicleId), eq(vehicles.tenantId, tenantId)))
        .limit(1),
      db
        .select({ id: vehicleDefects.id })
        .from(vehicleDefects)
        .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
        .where(and(
          eq(vehicleDefects.vehicleId, trip.vehicleId),
          eq(vehicles.tenantId, tenantId),
          eq(vehicleDefects.isBlocking, true),
          isNull(vehicleDefects.resolvedAt),
        ))
        .limit(1),
    ]);
    if (!currentVehicle) {
      return NextResponse.json({ error: 'Trip vehicle no longer exists in this tenant' }, { status: 409 });
    }
    const resultingVehicleStatus = blockingDefect
      ? 'maintenance'
      : RESTRICTED_VEHICLE_STATUSES.has(currentVehicle.status)
        ? currentVehicle.status
        : 'available';
    const liveVehicleClosureStatus = sql<string>`case
      when ${vehicles.status} in ('maintenance', 'out_of_service', 'written_off') then ${vehicles.status}
      when exists (
        select 1
        from ${vehicleDefects} vd
        where vd.vehicle_id = ${trip.vehicleId}::uuid
          and vd.is_blocking = true
          and vd.resolved_at is null
      ) then 'maintenance'
      else 'available'
    end`;

    const closureId = randomUUID();
    const now = new Date();
    await runAtomicMutations((tx) => {
      const mutations: Array<PromiseLike<unknown>> = [
        tx.execute(sql`
          SELECT CAST(CASE
            WHEN NOT EXISTS (
              SELECT 1
              FROM trip_incidents ti
              JOIN trip_authorities ta
                ON ta.trip_id = ti.trip_id
               AND ta.tenant_id = ti.tenant_id
              WHERE ti.trip_id = ${id}::uuid
                AND ti.tenant_id = ${tenantId}::uuid
                AND COALESCE((ta.data -> 'returnDeclaration' ->> 'incidentDeclared')::boolean, false) = false
                AND NULLIF(ta.data -> 'returnDeclaration' ->> 'reconciledAt', '') IS NULL
            )
            AND NOT EXISTS (
              SELECT 1
              FROM trip_incidents safety_incident
              WHERE safety_incident.trip_id = ${id}::uuid
                AND safety_incident.tenant_id = ${tenantId}::uuid
                AND (
                  safety_incident.safe_to_continue = false
                  OR safety_incident.vehicle_safe = false
                  OR safety_incident.vehicle_damage = true
                  OR safety_incident.severity = 'critical'
                )
                AND (
                  safety_incident.status <> 'resolved'
                  OR safety_incident.technical_clearance_status <> 'cleared'
                )
            )
            THEN '1'
            ELSE 'trip_closure_lifecycle_conflict'
          END AS integer) AS guard
        `),
        tx.insert(tripClosures).values({
          id: closureId,
          tripId: id,
          authorisedKilometres,
          actualKilometres,
          kilometreVariance,
          vehicleOdometerReadings,
          totalFuelLitres: totalFuelLitres ? String(totalFuelLitres) : null,
          totalFuelCost: totalFuelCost ? String(totalFuelCost) : null,
          reviewNotes: reviewNotes || null,
          closedByUserId: userId,
          decision,
        }),
        tx.update(tripAuthorities)
          .set({ status: 'completed', version: sql`${tripAuthorities.version} + 1`, updatedAt: now })
          .where(and(
            eq(tripAuthorities.id, authority.id),
            eq(tripAuthorities.tenantId, tenantId),
            eq(tripAuthorities.status, 'awaiting_reconciliation'),
          )),
        tx.update(tripAuthorities)
          .set({ status: 'closed', version: sql`${tripAuthorities.version} + 1`, updatedAt: now })
          .where(and(
            eq(tripAuthorities.id, authority.id),
            eq(tripAuthorities.tenantId, tenantId),
            eq(tripAuthorities.status, 'completed'),
          )),
        tx.update(trips)
          .set({ status: 'closed', closedAt: now, updatedAt: now })
          .where(and(
            eq(trips.id, id),
            eq(trips.tenantId, tenantId),
            inArray(trips.status, ['return_inspection', 'closure_review']),
          )),
        tx.update(transportRequests)
          .set({ status: 'closed', updatedAt: now })
          .where(and(eq(transportRequests.id, trip.requestId), eq(transportRequests.tenantId, tenantId))),
        tx.update(vehicleAllocations)
          .set({ state: 'released', updatedAt: now })
          .where(and(
            eq(vehicleAllocations.id, trip.allocationId),
            inArray(vehicleAllocations.state, ['provisional', 'confirmed']),
            sql`exists (
              select 1 from ${transportRequests} tr
              where tr.id = ${vehicleAllocations.requestId}
                and tr.tenant_id = ${tenantId}
            )`,
          )),
        tx.update(externalDriverAssignments)
          .set({ state: 'completed', updatedAt: now })
          .where(and(
            eq(externalDriverAssignments.tenantId, tenantId),
            eq(externalDriverAssignments.tripId, id),
            eq(externalDriverAssignments.allocationId, trip.allocationId),
            eq(externalDriverAssignments.state, 'accepted'),
          )),
        tx.update(vehicles)
          .set({ status: liveVehicleClosureStatus, updatedAt: now })
          .where(and(eq(vehicles.id, trip.vehicleId), eq(vehicles.tenantId, tenantId))),
        tx.insert(auditEvents).values({
          tenantId,
          tenantSequence: Date.now(),
          eventType: 'trip_closed',
          actorUserId: userId,
          action: 'close',
          entityType: 'trip',
          entityId: id,
          summary: `Trip closed: ${totalFuelLitres}L fuel used, ${totalFuelCost} total cost`,
          sourceChannel: 'web',
          after: {
            vehicleStatusBefore: currentVehicle.status,
            vehicleStatusAfter: resultingVehicleStatus,
            vehicleRestrictionPreserved: currentVehicle.status === resultingVehicleStatus && RESTRICTED_VEHICLE_STATUSES.has(currentVehicle.status),
          },
        }),
      ];

      if (currentVehicle.status !== resultingVehicleStatus) {
        mutations.push(
          tx.insert(vehicleStatusEvents).values({
            vehicleId: trip.vehicleId,
            previousStatus: currentVehicle.status,
            newStatus: resultingVehicleStatus,
            reason: blockingDefect
              ? 'Trip closed with unresolved blocking defect'
              : `Trip closed: ${id.slice(0, 8)}...`,
            changedByUserId: userId,
            referenceEntityType: 'trip',
            referenceEntityId: id,
          }),
        );
      }

      mutations.push(
        tx.execute(sql`
          SELECT CAST(CASE
            WHEN EXISTS (
              SELECT 1 FROM trip_closures tc
              WHERE tc.id = ${closureId}::uuid
                AND tc.trip_id = ${id}::uuid
            )
            AND EXISTS (
              SELECT 1 FROM trips t
              WHERE t.id = ${id}::uuid
                AND t.tenant_id = ${tenantId}::uuid
                AND t.status = 'closed'
            )
            AND EXISTS (
              SELECT 1 FROM transport_requests tr
              WHERE tr.id = ${trip.requestId}::uuid
                AND tr.tenant_id = ${tenantId}::uuid
                AND tr.status = 'closed'
            )
            AND EXISTS (
              SELECT 1 FROM vehicle_allocations va
              WHERE va.id = ${trip.allocationId}::uuid
                AND va.state = 'released'
            )
            AND EXISTS (
              SELECT 1 FROM trip_authorities ta
              WHERE ta.id = ${authority.id}::uuid
                AND ta.tenant_id = ${tenantId}::uuid
                AND ta.status = 'closed'
            )
            AND NOT EXISTS (
              SELECT 1 FROM external_driver_assignments eda
              WHERE eda.tenant_id = ${tenantId}::uuid
                AND eda.trip_id = ${id}::uuid
                AND eda.allocation_id = ${trip.allocationId}::uuid
                AND eda.state = 'accepted'
            )
            THEN '1'
            ELSE 'trip_closure_transition_conflict'
          END AS integer) AS guard
        `),
      );
      return mutations;
    });

    const [[updatedTrip], [closure], [requestRecord]] = await Promise.all([
      db.select().from(trips).where(and(eq(trips.id, id), eq(trips.tenantId, tenantId))).limit(1),
      db.select().from(tripClosures).where(eq(tripClosures.id, closureId)).limit(1),
      db.select({ reference: transportRequests.reference }).from(transportRequests)
        .where(and(eq(transportRequests.id, trip.requestId), eq(transportRequests.tenantId, tenantId))).limit(1),
    ]);

    if (requestRecord) {
      try {
        await recordTenantRequestActivity({
          tenantId,
          requestId: trip.requestId,
          reference: requestRecord.reference,
          stage: 'closed',
          officeLabel: 'Transport reconciliation',
        });
      } catch (activityError) {
        console.warn('[trips/close] Post-commit request activity failed:', activityError);
      }
    }

    let documents: Awaited<ReturnType<typeof onTripClosed>> | null = null;
    try {
      documents = await onTripClosed(id, tenantId, userId);
    } catch (documentError) {
      console.warn('[trips/close] Post-commit document generation failed:', documentError);
    }

    return NextResponse.json({
      trip: updatedTrip,
      closure,
      documents: documents?.filter(Boolean) || [],
    });
  } catch (error) {
    console.error('[trips/close] POST failed:', error);
    const { code, message } = getDatabaseErrorDetails(error);
    if (code === '23505') {
      return NextResponse.json({ error: 'Trip is already closed' }, { status: 409 });
    }
    if (message.includes('closure_decision_conflict')) {
      return NextResponse.json(
        { error: 'This closure decision is no longer current. Refresh and review the latest trip state.' },
        { status: 409 },
      );
    }
    if (
      message.includes('trip_closure_lifecycle_conflict') ||
      message.includes('trip_closure_transition_conflict')
    ) {
      return NextResponse.json(
        {
          error:
            'The trip, inspection, financial, safety, or return-declaration state changed while closure was being processed. Refresh the closure review and resolve the latest blockers before closing.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to close trip' }, { status: 500 });
  }
}