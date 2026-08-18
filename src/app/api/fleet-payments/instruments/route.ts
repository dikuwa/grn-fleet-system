import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  FLEET_PAYMENT_INSTRUMENT_TYPES,
  FLEET_PAYMENT_STATUSES,
  fleetPaymentInstruments,
  fleetPaymentProviders,
} from '@/db/schema/fleet-payments';
import { vehicles } from '@/db/schema/fleet';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { maskFleetPaymentIdentifier } from '@/lib/fleet-payments/service';
import { recordAuditEvent } from '@/lib/audit-event';

async function permissions(session: Parameters<typeof hasPermission>[0]) {
  const [tenantManage, fuelManage, tripManage] = await Promise.all([
    hasPermission(session, Permissions.TENANT_MANAGE),
    hasPermission(session, Permissions.FUEL_MANAGE),
    hasPermission(session, Permissions.TRIP_MANAGE),
  ]);
  return { canView: tenantManage || fuelManage || tripManage, canManage: tenantManage || fuelManage || tripManage };
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const access = await permissions(session);
  if (!access.canView) return NextResponse.json({ error: 'Fleet payment access is restricted.' }, { status: 403 });
  const vehicleId = new URL(request.url).searchParams.get('vehicleId');
  const db = getDb();
  const conditions = [eq(fleetPaymentInstruments.tenantId, session.tenantId)];
  if (vehicleId) conditions.push(eq(fleetPaymentInstruments.vehicleId, vehicleId));
  const rows = await db
    .select({
      id: fleetPaymentInstruments.id,
      providerId: fleetPaymentInstruments.providerId,
      providerName: fleetPaymentProviders.providerName,
      providerType: fleetPaymentProviders.providerType,
      instrumentType: fleetPaymentInstruments.instrumentType,
      displayName: fleetPaymentInstruments.displayName,
      maskedIdentifier: fleetPaymentInstruments.maskedIdentifier,
      externalReference: fleetPaymentInstruments.externalReference,
      vehicleId: fleetPaymentInstruments.vehicleId,
      vehicleLicence: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      status: fleetPaymentInstruments.status,
      validFrom: fleetPaymentInstruments.validFrom,
      validUntil: fleetPaymentInstruments.validUntil,
      allowedCategories: fleetPaymentInstruments.allowedCategories,
      spendingLimit: fleetPaymentInstruments.spendingLimit,
      currency: fleetPaymentInstruments.currency,
      notes: fleetPaymentInstruments.notes,
    })
    .from(fleetPaymentInstruments)
    .innerJoin(fleetPaymentProviders, eq(fleetPaymentInstruments.providerId, fleetPaymentProviders.id))
    .leftJoin(vehicles, eq(fleetPaymentInstruments.vehicleId, vehicles.id))
    .where(and(...conditions))
    .orderBy(asc(fleetPaymentProviders.providerName), asc(fleetPaymentInstruments.maskedIdentifier));
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const access = await permissions(session);
  if (!access.canManage) return NextResponse.json({ error: 'You cannot manage fleet payment instruments.' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const providerId = String(body.providerId || '').trim();
  const instrumentType = String(body.instrumentType || 'card').trim();
  const identifier = String(body.identifier || body.maskedIdentifier || '').trim();
  const vehicleId = typeof body.vehicleId === 'string' && body.vehicleId.trim() ? body.vehicleId.trim() : null;
  if (!providerId || !identifier) return NextResponse.json({ error: 'Provider and instrument identifier are required.' }, { status: 422 });
  if (!FLEET_PAYMENT_INSTRUMENT_TYPES.includes(instrumentType as (typeof FLEET_PAYMENT_INSTRUMENT_TYPES)[number])) {
    return NextResponse.json({ error: 'Select a valid instrument type.' }, { status: 422 });
  }

  const db = getDb();
  const [provider] = await db
    .select({ id: fleetPaymentProviders.id, providerName: fleetPaymentProviders.providerName })
    .from(fleetPaymentProviders)
    .where(and(eq(fleetPaymentProviders.id, providerId), eq(fleetPaymentProviders.tenantId, session.tenantId)))
    .limit(1);
  if (!provider) return NextResponse.json({ error: 'Provider not found in this tenant.' }, { status: 404 });
  if (vehicleId) {
    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found in this tenant.' }, { status: 404 });
  }
  const id = randomUUID();
  const validFrom = body.validFrom ? new Date(String(body.validFrom)) : null;
  const validUntil = body.validUntil ? new Date(String(body.validUntil)) : null;
  if (validFrom && Number.isNaN(validFrom.getTime())) return NextResponse.json({ error: 'Valid-from date is invalid.' }, { status: 422 });
  if (validUntil && Number.isNaN(validUntil.getTime())) return NextResponse.json({ error: 'Expiry date is invalid.' }, { status: 422 });
  if (validFrom && validUntil && validUntil < validFrom) return NextResponse.json({ error: 'Expiry must be after the valid-from date.' }, { status: 422 });
  const allowedCategories = Array.isArray(body.allowedCategories)
    ? body.allowedCategories.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
  await db.insert(fleetPaymentInstruments).values({
    id,
    tenantId: session.tenantId,
    providerId,
    vehicleId,
    instrumentType,
    displayName: typeof body.displayName === 'string' ? body.displayName.trim() || null : null,
    maskedIdentifier: identifier.includes('•') ? identifier.slice(0, 64) : maskFleetPaymentIdentifier(identifier),
    externalReference: typeof body.externalReference === 'string' ? body.externalReference.trim() || null : null,
    status: 'active',
    validFrom,
    validUntil,
    allowedCategories,
    spendingLimit:
      body.spendingLimit !== undefined && body.spendingLimit !== null && body.spendingLimit !== ''
        ? Number(body.spendingLimit).toFixed(2)
        : null,
    currency: typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : 'NAD',
    notes: typeof body.notes === 'string' ? body.notes.trim() || null : null,
    metadata: {},
    createdByUserId: session.user.id,
  });
  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    action: 'fleet_payment_instrument.created',
    entityType: 'fleet_payment_instrument',
    entityId: id,
    summary: `${provider.providerName} instrument ${maskFleetPaymentIdentifier(identifier)} registered`,
    after: { providerId, vehicleId, instrumentType, allowedCategories },
  });
  const [created] = await db.select().from(fleetPaymentInstruments).where(eq(fleetPaymentInstruments.id, id)).limit(1);
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const access = await permissions(session);
  if (!access.canManage) return NextResponse.json({ error: 'You cannot manage fleet payment instruments.' }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const instrumentId = typeof body.instrumentId === 'string' ? body.instrumentId : '';
  if (!instrumentId) return NextResponse.json({ error: 'Instrument is required.' }, { status: 400 });
  const db = getDb();
  const [current] = await db
    .select()
    .from(fleetPaymentInstruments)
    .where(and(eq(fleetPaymentInstruments.id, instrumentId), eq(fleetPaymentInstruments.tenantId, session.tenantId)))
    .limit(1);
  if (!current) return NextResponse.json({ error: 'Instrument not found.' }, { status: 404 });
  const status = typeof body.status === 'string' ? body.status : current.status;
  if (!FLEET_PAYMENT_STATUSES.includes(status as (typeof FLEET_PAYMENT_STATUSES)[number])) {
    return NextResponse.json({ error: 'Invalid instrument status.' }, { status: 422 });
  }
  const vehicleId = body.vehicleId === null ? null : typeof body.vehicleId === 'string' ? body.vehicleId.trim() || null : current.vehicleId;
  if (vehicleId) {
    const [vehicle] = await db.select({ id: vehicles.id }).from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, session.tenantId))).limit(1);
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found in this tenant.' }, { status: 404 });
  }
  await db
    .update(fleetPaymentInstruments)
    .set({
      vehicleId,
      displayName: typeof body.displayName === 'string' ? body.displayName.trim() || null : current.displayName,
      status,
      allowedCategories: Array.isArray(body.allowedCategories)
        ? body.allowedCategories.filter((item): item is string => typeof item === 'string')
        : current.allowedCategories,
      notes: typeof body.notes === 'string' ? body.notes.trim() || null : current.notes,
      updatedAt: new Date(),
    })
    .where(and(eq(fleetPaymentInstruments.id, instrumentId), eq(fleetPaymentInstruments.tenantId, session.tenantId)));
  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    action: 'fleet_payment_instrument.updated',
    entityType: 'fleet_payment_instrument',
    entityId: instrumentId,
    summary: `Fleet payment instrument ${current.maskedIdentifier} updated`,
    before: { vehicleId: current.vehicleId, status: current.status },
    after: { vehicleId, status },
  });
  const [updated] = await db.select().from(fleetPaymentInstruments).where(eq(fleetPaymentInstruments.id, instrumentId)).limit(1);
  return NextResponse.json({ success: true, data: updated });
}
