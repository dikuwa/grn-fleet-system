import { randomUUID } from 'crypto';
import { getDb } from '@/db';
import { tripAuthorities, trips, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { and, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import type { AuthSession } from '@/lib/auth-helpers';
import { onTripIssued } from '@/lib/document-generator';

export interface ReplaceVehicleInput {
  allocationId: string;
  replacementVehicleId: string;
  reason: string;
  handoverOdometer?: number | null;
  outgoingVehicleDisposition?: 'available' | 'maintenance' | null;
}

export interface ReplaceVehicleResult {
  success: boolean;
  replacementVehicleId: string;
  originalVehicleId: string;
  handoverOdometer?: number | null;
  outgoingVehicleDisposition?: 'available' | 'maintenance' | null;
  issueReset?: boolean;
  authorityDocumentId?: string | null;
  authorityRegenerationRequired?: boolean;
}

const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed'] as const;
const ACTIVE_TRIP_STATUSES = ['in_progress', 'return_due', 'return_inspection', 'closure_review'] as const;
const OUTGOING_DISPOSITIONS = ['available', 'maintenance'] as const;

export async function replaceVehicle(
  input: ReplaceVehicleInput,
  session: AuthSession,
): Promise<ReplaceVehicleResult> {
  const db = getDb();
  const {
    allocationId,
    replacementVehicleId,
    reason,
    handoverOdometer,
    outgoingVehicleDisposition,
  } = input;
  const tenantId = session.tenantId;
  const cleanReason = reason?.trim();

  if (!replacementVehicleId || !cleanReason) {
    throw new VehicleReplaceError('Replacement vehicle and reason are required');
  }
  if (cleanReason.length > 500) {
    throw new VehicleReplaceError('Replacement reason must be 500 characters or fewer', 422);
  }
  if (handoverOdometer != null && (!Number.isInteger(handoverOdometer) || handoverOdometer < 0)) {
    throw new VehicleReplaceError('Handover odometer must be a non-negative whole number', 422);
  }

  const [context] = await db
    .select({
      allocationId: vehicleAllocations.id,
      allocationState: vehicleAllocations.state,
      allocationVersion: vehicleAllocations.version,
      originalVehicleId: vehicleAllocations.vehicleId,
      startAt: vehicleAllocations.startAt,
      endAt: vehicleAllocations.endAt,
      replacedFromVehicleId: vehicleAllocations.replacedFromVehicleId,
      requestId: vehicleAllocations.requestId,
      requestStatus: transportRequests.status,
      tripId: trips.id,
      tripStatus: trips.status,
      issuedAt: trips.issuedAt,
      authorityId: tripAuthorities.id,
      authorityVersion: tripAuthorities.version,
      authorityData: tripAuthorities.data,
      authorityStatus: tripAuthorities.status,
      originalVehicleStatus: vehicles.status,
      originalVehicleOdometer: vehicles.currentOdometer,
    })
    .from(vehicleAllocations)
    .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
    .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
    .leftJoin(trips, eq(trips.allocationId, vehicleAllocations.id))
    .leftJoin(tripAuthorities, eq(tripAuthorities.allocationId, vehicleAllocations.id))
    .where(and(
      eq(vehicleAllocations.id, allocationId),
      eq(transportRequests.tenantId, tenantId),
      eq(vehicles.tenantId, tenantId),
    ))
    .limit(1);

  if (!context) throw new VehicleReplaceError('Allocation not found', 404);
  if (!LIVE_ALLOCATION_STATES.includes(context.allocationState as (typeof LIVE_ALLOCATION_STATES)[number])) {
    throw new VehicleReplaceError(
      `Vehicle replacement is not allowed from '${context.allocationState}' allocation state`,
      409,
    );
  }
  if (replacementVehicleId === context.originalVehicleId) {
    throw new VehicleReplaceError('Replacement vehicle is the same as the current vehicle');
  }
  if (context.replacedFromVehicleId) {
    throw new VehicleReplaceError(
      'This allocation already records a vehicle replacement. Use the incident/escalation workflow for another swap so vehicle history is not overwritten.',
      409,
    );
  }

  const activeMidTrip = Boolean(
    context.tripStatus && ACTIVE_TRIP_STATUSES.includes(
      context.tripStatus as (typeof ACTIVE_TRIP_STATUSES)[number],
    ),
  );
  const preDeparture = context.tripStatus === 'pending';
  const issuedPreStart = Boolean(context.issuedAt && preDeparture);

  if (activeMidTrip && handoverOdometer == null) {
    throw new VehicleReplaceError('Odometer reading at handover is required during an active trip', 409);
  }
  if (
    activeMidTrip &&
    handoverOdometer != null &&
    handoverOdometer < (context.originalVehicleOdometer ?? 0)
  ) {
    throw new VehicleReplaceError(
      `Handover odometer cannot be below the current vehicle reading (${context.originalVehicleOdometer ?? 0})`,
      422,
    );
  }
  if (
    activeMidTrip &&
    !OUTGOING_DISPOSITIONS.includes(
      outgoingVehicleDisposition as (typeof OUTGOING_DISPOSITIONS)[number],
    )
  ) {
    throw new VehicleReplaceError(
      'Choose whether the outgoing vehicle is available for service or must go to maintenance',
      422,
    );
  }
  if (issuedPreStart && context.requestStatus !== 'vehicle_issued') {
    throw new VehicleReplaceError(
      'The trip issue state is inconsistent. Refresh the trip before replacing the vehicle.',
      409,
    );
  }

  const [replacement] = await db
    .select({
      id: vehicles.id,
      status: vehicles.status,
      currentOdometer: vehicles.currentOdometer,
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      make: vehicles.make,
      model: vehicles.model,
      colour: vehicles.colour,
      fuelType: vehicles.fuelType,
      seatedCapacity: vehicles.seatedCapacity,
      licenceExpiryDate: vehicles.licenceExpiryDate,
    })
    .from(vehicles)
    .where(and(eq(vehicles.id, replacementVehicleId), eq(vehicles.tenantId, tenantId)))
    .limit(1);
  if (!replacement) throw new VehicleReplaceError('Replacement vehicle not found in this tenant', 404);
  if (replacement.status !== 'available') {
    throw new VehicleReplaceError(`Replacement vehicle is not available (status: ${replacement.status})`, 409);
  }

  const [conflict] = await db
    .select({ id: vehicleAllocations.id })
    .from(vehicleAllocations)
    .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
    .where(and(
      eq(transportRequests.tenantId, tenantId),
      eq(vehicleAllocations.vehicleId, replacementVehicleId),
      ne(vehicleAllocations.id, allocationId),
      inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
      lt(vehicleAllocations.startAt, context.endAt),
      gt(vehicleAllocations.endAt, context.startAt),
    ))
    .limit(1);
  if (conflict) {
    throw new VehicleReplaceError('Replacement vehicle is already allocated during this period', 409);
  }

  const originalAuthorityData = (context.authorityData ?? {}) as Record<string, unknown>;
  const replacementSnapshot = {
    id: replacement.id,
    registration: replacement.licenceNumber,
    registerNumber: replacement.vehicleRegisterNumber,
    make: replacement.make,
    model: replacement.model,
    colour: replacement.colour,
    fuelType: replacement.fuelType,
    seatedCapacity: replacement.seatedCapacity,
    licenceExpiryDate: replacement.licenceExpiryDate,
  };
  const nextAuthorityData = context.authorityId
    ? { ...originalAuthorityData, vehicle: replacementSnapshot }
    : null;
  const amendmentId = context.authorityId ? randomUUID() : null;
  const nextAuthorityVersion = (context.authorityVersion ?? 1) + 1;
  const now = new Date();
  const disposition = activeMidTrip ? outgoingVehicleDisposition! : null;
  const originalValueJson = JSON.stringify({
    vehicleId: context.originalVehicleId,
    vehicle: originalAuthorityData.vehicle ?? null,
  });
  const newValueJson = JSON.stringify({
    vehicleId: replacementVehicleId,
    vehicle: replacementSnapshot,
    handoverOdometer: handoverOdometer ?? null,
    outgoingVehicleDisposition: disposition,
    issueReset: issuedPreStart,
  });
  const authorityDataJson = JSON.stringify(nextAuthorityData ?? {});
  const auditAfterJson = JSON.stringify({
    vehicleId: replacementVehicleId,
    reason: cleanReason,
    handoverOdometer: handoverOdometer ?? null,
    activeMidTrip,
    outgoingVehicleDisposition: disposition,
    issueReset: issuedPreStart,
    authorityAmendmentId: amendmentId,
  });

  try {
    await db.execute(sql`
      WITH candidate_lock AS (
        UPDATE vehicles
        SET status = status
        WHERE id = ${replacementVehicleId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = 'available'
        RETURNING id
      ),
      allocation_claim AS (
        UPDATE vehicle_allocations
        SET vehicle_id = ${replacementVehicleId}::uuid,
            replaced_from_vehicle_id = ${context.originalVehicleId}::uuid,
            replacement_reason = ${cleanReason},
            replacement_at = ${now},
            updated_at = ${now},
            version = version + 1
        WHERE id = ${allocationId}::uuid
          AND vehicle_id = ${context.originalVehicleId}::uuid
          AND state = ${context.allocationState}
          AND version = ${context.allocationVersion}
          AND replaced_from_vehicle_id IS NULL
          AND EXISTS (SELECT 1 FROM candidate_lock)
          AND NOT EXISTS (
            SELECT 1
            FROM vehicle_allocations other
            INNER JOIN transport_requests req ON req.id = other.request_id
            WHERE req.tenant_id = ${tenantId}::uuid
              AND other.vehicle_id = ${replacementVehicleId}::uuid
              AND other.id <> ${allocationId}::uuid
              AND other.state IN ('provisional', 'confirmed')
              AND other.start_at < ${context.endAt}
              AND other.end_at > ${context.startAt}
          )
        RETURNING id
      ),
      trip_update AS (
        UPDATE trips
        SET vehicle_id = ${replacementVehicleId}::uuid,
            issued_at = CASE WHEN ${issuedPreStart} THEN NULL ELSE issued_at END,
            updated_at = ${now},
            version = version + 1
        WHERE id = ${context.tripId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND vehicle_id = ${context.originalVehicleId}::uuid
          AND EXISTS (SELECT 1 FROM allocation_claim)
        RETURNING id
      ),
      external_issue_reset AS (
        UPDATE external_driver_assignments
        SET issue_id = NULL, updated_at = ${now}
        WHERE allocation_id = ${allocationId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND issue_id IS NOT NULL
          AND ${issuedPreStart}
          AND EXISTS (SELECT 1 FROM allocation_claim)
        RETURNING id
      ),
      request_reset AS (
        UPDATE transport_requests
        SET status = 'authorised', updated_at = ${now}
        WHERE id = ${context.requestId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = 'vehicle_issued'
          AND ${issuedPreStart}
          AND EXISTS (SELECT 1 FROM allocation_claim)
        RETURNING id
      ),
      authority_update AS (
        UPDATE trip_authorities
        SET data = ${authorityDataJson}::jsonb,
            status = CASE
              WHEN ${preDeparture} AND status IN ('awaiting_pre_trip_inspection', 'ready_for_departure')
                THEN 'awaiting_pre_trip_inspection'
              ELSE status
            END,
            version = version + 1,
            document_version = document_version + 1,
            updated_at = ${now}
        WHERE id = ${context.authorityId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND version = ${context.authorityVersion}
          AND EXISTS (SELECT 1 FROM allocation_claim)
        RETURNING *
      ),
      amendment_insert AS (
        INSERT INTO trip_amendments (
          id, authority_id, amendment_type, original_value, new_value, reason,
          status, requested_by_user_id, approved_by_user_id, approved_at, version
        )
        SELECT
          ${amendmentId}::uuid,
          id,
          'vehicle_replacement',
          ${originalValueJson}::jsonb,
          ${newValueJson}::jsonb,
          ${cleanReason},
          'approved',
          ${session.user.id},
          ${session.user.id},
          ${now},
          ${nextAuthorityVersion}
        FROM authority_update
        RETURNING id
      ),
      version_insert AS (
        INSERT INTO trip_authority_versions (
          authority_id, version, status, snapshot, reason, created_by_user_id
        )
        SELECT
          id,
          version,
          status,
          to_jsonb(authority_update),
          ${cleanReason},
          ${session.user.id}
        FROM authority_update
        RETURNING id
      ),
      outgoing_vehicle_update AS (
        UPDATE vehicles
        SET status = ${disposition}, updated_at = ${now}
        WHERE id = ${context.originalVehicleId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND ${activeMidTrip}
          AND EXISTS (SELECT 1 FROM allocation_claim)
        RETURNING id
      ),
      replacement_vehicle_update AS (
        UPDATE vehicles
        SET status = 'allocated', updated_at = ${now}
        WHERE id = ${replacementVehicleId}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = 'available'
          AND ${activeMidTrip}
          AND EXISTS (SELECT 1 FROM outgoing_vehicle_update)
        RETURNING id
      ),
      outgoing_status_event AS (
        INSERT INTO vehicle_status_events (
          vehicle_id, previous_status, new_status, reason, changed_by_user_id,
          reference_entity_type, reference_entity_id
        )
        SELECT
          ${context.originalVehicleId}::uuid,
          ${context.originalVehicleStatus},
          ${disposition},
          ${`Vehicle replaced on allocation ${allocationId.slice(0, 8)}...`},
          ${session.user.id},
          'allocation',
          ${allocationId}::uuid
        FROM outgoing_vehicle_update
        RETURNING id
      ),
      replacement_status_event AS (
        INSERT INTO vehicle_status_events (
          vehicle_id, previous_status, new_status, reason, changed_by_user_id,
          reference_entity_type, reference_entity_id
        )
        SELECT
          ${replacementVehicleId}::uuid,
          'available',
          'allocated',
          ${`Replacement for vehicle ${context.originalVehicleId.slice(0, 8)}...`},
          ${session.user.id},
          'allocation',
          ${allocationId}::uuid
        FROM replacement_vehicle_update
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id, action,
          entity_type, entity_id, summary, before, after, reason, source_channel
        )
        SELECT
          ${tenantId}::uuid,
          ${Date.now()},
          'allocation_vehicle_replaced',
          ${session.user.id},
          'replace_vehicle',
          'allocation',
          ${allocationId}::uuid,
          ${`Allocation vehicle replaced: ${context.originalVehicleId.slice(0, 8)}… → ${replacementVehicleId.slice(0, 8)}…`},
          jsonb_build_object('vehicleId', ${context.originalVehicleId}::text, 'state', ${context.allocationState}),
          ${auditAfterJson}::jsonb,
          ${cleanReason},
          'web'
        FROM allocation_claim
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM candidate_lock) = 1
         AND (SELECT count(*) FROM allocation_claim) = 1
         AND CASE WHEN ${Boolean(context.tripId)} THEN (SELECT count(*) FROM trip_update) = 1 ELSE true END
         AND CASE WHEN ${Boolean(context.authorityId)} THEN
           (SELECT count(*) FROM authority_update) = 1
           AND (SELECT count(*) FROM amendment_insert) = 1
           AND (SELECT count(*) FROM version_insert) = 1
           ELSE true END
         AND CASE WHEN ${issuedPreStart} THEN (SELECT count(*) FROM request_reset) = 1 ELSE true END
         AND CASE WHEN ${activeMidTrip} THEN
           (SELECT count(*) FROM outgoing_vehicle_update) = 1
           AND (SELECT count(*) FROM replacement_vehicle_update) = 1
           AND (SELECT count(*) FROM outgoing_status_event) = 1
           AND (SELECT count(*) FROM replacement_status_event) = 1
           ELSE true END
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_vehicle_replacement_failed_' || (SELECT count(*) FROM allocation_claim)::text
      END AS integer) AS committed
    `);
  } catch (error) {
    if (String(error).includes('atomic_vehicle_replacement_failed')) {
      throw new VehicleReplaceError(
        'The allocation, vehicle, or Trip Authority changed while the replacement was being saved. Refresh and try again.',
        409,
      );
    }
    if ((error as { code?: string })?.code === '23505') {
      throw new VehicleReplaceError(
        'The replacement conflicts with a concurrent allocation or authority update. Refresh and try again.',
        409,
      );
    }
    throw error;
  }

  let authorityDocumentId: string | null = null;
  let authorityRegenerationRequired = false;
  if (preDeparture && context.authorityId) {
    try {
      const document = await onTripIssued(allocationId, tenantId, session.user.id);
      authorityDocumentId = document?.id ?? null;
      authorityRegenerationRequired = !document;
    } catch (error) {
      authorityRegenerationRequired = true;
      console.warn('[vehicle-replacement] Trip Authority draft refresh failed after replacement:', error);
    }
  }

  return {
    success: true,
    replacementVehicleId,
    originalVehicleId: context.originalVehicleId,
    handoverOdometer: handoverOdometer ?? null,
    outgoingVehicleDisposition: disposition,
    issueReset: issuedPreStart,
    authorityDocumentId,
    authorityRegenerationRequired,
  };
}

export class VehicleReplaceError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'VehicleReplaceError';
    this.status = status;
  }
}
