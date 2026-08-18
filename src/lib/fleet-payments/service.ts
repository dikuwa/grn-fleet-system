import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  fleetPaymentAssignments,
  fleetPaymentInstruments,
  fleetPaymentProviders,
} from '@/db/schema/fleet-payments';
import { trips, vehicleAllocations } from '@/db/schema/trips';

export type ResolvedFleetPayment = {
  providerId: string;
  providerName: string;
  providerType: string;
  integrationMode: string;
  requireForRelease: boolean;
  instrumentId: string;
  instrumentType: string;
  maskedIdentifier: string;
  displayName: string | null;
  vehicleId: string | null;
};

export async function resolveVehicleFleetPayment(input: {
  tenantId: string;
  vehicleId: string;
  at?: Date;
}): Promise<ResolvedFleetPayment | null> {
  const db = getDb();
  const at = input.at ?? new Date();
  const [row] = await db
    .select({
      providerId: fleetPaymentProviders.id,
      providerName: fleetPaymentProviders.providerName,
      providerType: fleetPaymentProviders.providerType,
      integrationMode: fleetPaymentProviders.integrationMode,
      requireForRelease: fleetPaymentProviders.requireForRelease,
      instrumentId: fleetPaymentInstruments.id,
      instrumentType: fleetPaymentInstruments.instrumentType,
      maskedIdentifier: fleetPaymentInstruments.maskedIdentifier,
      displayName: fleetPaymentInstruments.displayName,
      vehicleId: fleetPaymentInstruments.vehicleId,
    })
    .from(fleetPaymentInstruments)
    .innerJoin(fleetPaymentProviders, eq(fleetPaymentInstruments.providerId, fleetPaymentProviders.id))
    .where(
      and(
        eq(fleetPaymentInstruments.tenantId, input.tenantId),
        eq(fleetPaymentInstruments.vehicleId, input.vehicleId),
        eq(fleetPaymentInstruments.status, 'active'),
        eq(fleetPaymentProviders.status, 'active'),
        or(isNull(fleetPaymentInstruments.validFrom), lte(fleetPaymentInstruments.validFrom, at)),
        or(isNull(fleetPaymentInstruments.validUntil), gte(fleetPaymentInstruments.validUntil, at)),
      ),
    )
    .orderBy(desc(fleetPaymentProviders.isDefault), desc(fleetPaymentInstruments.updatedAt))
    .limit(1);

  return row ?? null;
}

export async function resolveTripFleetPayment(input: {
  tenantId: string;
  tripId: string;
}): Promise<(ResolvedFleetPayment & { assignmentId: string }) | null> {
  const db = getDb();
  const [assignment] = await db
    .select({
      assignmentId: fleetPaymentAssignments.id,
      providerId: fleetPaymentProviders.id,
      providerName: fleetPaymentProviders.providerName,
      providerType: fleetPaymentProviders.providerType,
      integrationMode: fleetPaymentProviders.integrationMode,
      requireForRelease: fleetPaymentProviders.requireForRelease,
      instrumentId: fleetPaymentInstruments.id,
      instrumentType: fleetPaymentInstruments.instrumentType,
      maskedIdentifier: fleetPaymentInstruments.maskedIdentifier,
      displayName: fleetPaymentInstruments.displayName,
      vehicleId: fleetPaymentInstruments.vehicleId,
    })
    .from(fleetPaymentAssignments)
    .innerJoin(fleetPaymentInstruments, eq(fleetPaymentAssignments.instrumentId, fleetPaymentInstruments.id))
    .innerJoin(fleetPaymentProviders, eq(fleetPaymentInstruments.providerId, fleetPaymentProviders.id))
    .where(
      and(
        eq(fleetPaymentAssignments.tenantId, input.tenantId),
        eq(fleetPaymentAssignments.tripId, input.tripId),
        eq(fleetPaymentAssignments.status, 'assigned'),
        eq(fleetPaymentInstruments.status, 'active'),
        eq(fleetPaymentProviders.status, 'active'),
      ),
    )
    .limit(1);
  if (assignment) return assignment;

  const [trip] = await db
    .select({ vehicleId: trips.vehicleId, allocationId: trips.allocationId })
    .from(trips)
    .where(and(eq(trips.id, input.tripId), eq(trips.tenantId, input.tenantId)))
    .limit(1);
  if (!trip) return null;

  const [allocation] = await db
    .select({ startAt: vehicleAllocations.startAt })
    .from(vehicleAllocations)
    .where(eq(vehicleAllocations.id, trip.allocationId))
    .limit(1);
  const resolved = await resolveVehicleFleetPayment({
    tenantId: input.tenantId,
    vehicleId: trip.vehicleId,
    at: allocation?.startAt ?? new Date(),
  });
  return resolved ? { ...resolved, assignmentId: '' } : null;
}

export async function validateFleetPaymentInstrument(input: {
  tenantId: string;
  instrumentId: string;
  vehicleId?: string | null;
  at?: Date;
}) {
  const db = getDb();
  const at = input.at ?? new Date();
  const [row] = await db
    .select({
      instrumentId: fleetPaymentInstruments.id,
      vehicleId: fleetPaymentInstruments.vehicleId,
      status: fleetPaymentInstruments.status,
      validFrom: fleetPaymentInstruments.validFrom,
      validUntil: fleetPaymentInstruments.validUntil,
      providerId: fleetPaymentProviders.id,
      providerName: fleetPaymentProviders.providerName,
      providerStatus: fleetPaymentProviders.status,
      providerType: fleetPaymentProviders.providerType,
    })
    .from(fleetPaymentInstruments)
    .innerJoin(fleetPaymentProviders, eq(fleetPaymentInstruments.providerId, fleetPaymentProviders.id))
    .where(
      and(
        eq(fleetPaymentInstruments.id, input.instrumentId),
        eq(fleetPaymentInstruments.tenantId, input.tenantId),
      ),
    )
    .limit(1);
  if (!row) return { ok: false as const, error: 'Fleet payment instrument was not found in this tenant.' };
  if (row.status !== 'active' || row.providerStatus !== 'active') {
    return { ok: false as const, error: 'Fleet payment instrument or provider is not active.' };
  }
  if (row.vehicleId && input.vehicleId && row.vehicleId !== input.vehicleId) {
    return { ok: false as const, error: 'This fleet payment instrument is linked to a different vehicle.' };
  }
  if (row.validFrom && row.validFrom > at) {
    return { ok: false as const, error: 'Fleet payment instrument is not valid yet.' };
  }
  if (row.validUntil && row.validUntil < at) {
    return { ok: false as const, error: 'Fleet payment instrument has expired.' };
  }
  return { ok: true as const, data: row };
}

export function maskFleetPaymentIdentifier(value: string): string {
  const cleaned = value.replace(/\s+/g, '').trim();
  if (!cleaned) return '••••';
  const last = cleaned.slice(-4);
  return `•••• ${last}`;
}
