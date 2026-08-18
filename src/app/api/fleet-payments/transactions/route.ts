import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  FLEET_PAYMENT_RECONCILIATION_STATUSES,
  FLEET_PAYMENT_TRANSACTION_SOURCES,
  FLEET_PAYMENT_TRANSACTION_STATUSES,
  fleetPaymentAssignments,
  fleetPaymentInstruments,
  fleetPaymentProviders,
  fleetPaymentTransactions,
} from '@/db/schema/fleet-payments';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { validateFleetPaymentInstrument } from '@/lib/fleet-payments/service';

async function canManage(session: Parameters<typeof hasPermission>[0]) {
  const results = await Promise.all([
    hasPermission(session, Permissions.TENANT_MANAGE),
    hasPermission(session, Permissions.FUEL_MANAGE),
    hasPermission(session, Permissions.TRIP_MANAGE),
    hasPermission(session, Permissions.FUEL_VERIFY),
  ]);
  return results.some(Boolean);
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  if (!(await canManage(session))) {
    return NextResponse.json({ error: 'Fleet payment ledger access is restricted.' }, { status: 403 });
  }
  const params = new URL(request.url).searchParams;
  const reconciliation = params.get('reconciliationStatus')?.trim();
  const providerId = params.get('providerId')?.trim();
  const vehicleId = params.get('vehicleId')?.trim();
  const limit = Math.min(Math.max(Number(params.get('limit') || 100), 1), 250);
  const conditions = [eq(fleetPaymentTransactions.tenantId, session.tenantId)];
  if (reconciliation) conditions.push(eq(fleetPaymentTransactions.reconciliationStatus, reconciliation));
  if (providerId) conditions.push(eq(fleetPaymentTransactions.providerId, providerId));
  if (vehicleId) conditions.push(eq(fleetPaymentTransactions.vehicleId, vehicleId));
  const db = getDb();
  const rows = await db
    .select({
      id: fleetPaymentTransactions.id,
      providerId: fleetPaymentTransactions.providerId,
      providerName: fleetPaymentProviders.providerName,
      instrumentId: fleetPaymentTransactions.instrumentId,
      maskedIdentifier: fleetPaymentInstruments.maskedIdentifier,
      tripId: fleetPaymentTransactions.tripId,
      vehicleId: fleetPaymentTransactions.vehicleId,
      externalTransactionId: fleetPaymentTransactions.externalTransactionId,
      transactionAt: fleetPaymentTransactions.transactionAt,
      merchant: fleetPaymentTransactions.merchant,
      location: fleetPaymentTransactions.location,
      category: fleetPaymentTransactions.category,
      litres: fleetPaymentTransactions.litres,
      unitPrice: fleetPaymentTransactions.unitPrice,
      amount: fleetPaymentTransactions.amount,
      currency: fleetPaymentTransactions.currency,
      odometerReading: fleetPaymentTransactions.odometerReading,
      status: fleetPaymentTransactions.status,
      source: fleetPaymentTransactions.source,
      reconciliationStatus: fleetPaymentTransactions.reconciliationStatus,
      reconciliationConfidence: fleetPaymentTransactions.reconciliationConfidence,
      matchedExpenseId: fleetPaymentTransactions.matchedExpenseId,
      matchedFuelTransactionId: fleetPaymentTransactions.matchedFuelTransactionId,
    })
    .from(fleetPaymentTransactions)
    .innerJoin(fleetPaymentProviders, eq(fleetPaymentTransactions.providerId, fleetPaymentProviders.id))
    .leftJoin(fleetPaymentInstruments, eq(fleetPaymentTransactions.instrumentId, fleetPaymentInstruments.id))
    .where(and(...conditions))
    .orderBy(desc(fleetPaymentTransactions.transactionAt))
    .limit(limit);
  return NextResponse.json({ success: true, data: rows });
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  if (!(await canManage(session))) {
    return NextResponse.json({ error: 'You cannot record fleet payment transactions.' }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const providerId = String(body.providerId || '').trim();
  const instrumentId = typeof body.instrumentId === 'string' && body.instrumentId.trim() ? body.instrumentId.trim() : null;
  const amount = Number(body.amount);
  const transactionAt = body.transactionAt ? new Date(String(body.transactionAt)) : new Date();
  const category = String(body.category || '').trim();
  const source = String(body.source || 'manual').trim();
  const status = String(body.status || 'approved').trim();
  const reconciliationStatus = String(body.reconciliationStatus || 'unmatched').trim();
  if (!providerId || !category || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Provider, category and a positive amount are required.' }, { status: 422 });
  }
  if (Number.isNaN(transactionAt.getTime())) return NextResponse.json({ error: 'Transaction date is invalid.' }, { status: 422 });
  if (!FLEET_PAYMENT_TRANSACTION_SOURCES.includes(source as (typeof FLEET_PAYMENT_TRANSACTION_SOURCES)[number])) {
    return NextResponse.json({ error: 'Invalid transaction source.' }, { status: 422 });
  }
  if (!FLEET_PAYMENT_TRANSACTION_STATUSES.includes(status as (typeof FLEET_PAYMENT_TRANSACTION_STATUSES)[number])) {
    return NextResponse.json({ error: 'Invalid transaction status.' }, { status: 422 });
  }
  if (!FLEET_PAYMENT_RECONCILIATION_STATUSES.includes(reconciliationStatus as (typeof FLEET_PAYMENT_RECONCILIATION_STATUSES)[number])) {
    return NextResponse.json({ error: 'Invalid reconciliation status.' }, { status: 422 });
  }
  const db = getDb();
  const [provider] = await db
    .select({ id: fleetPaymentProviders.id })
    .from(fleetPaymentProviders)
    .where(and(eq(fleetPaymentProviders.id, providerId), eq(fleetPaymentProviders.tenantId, session.tenantId)))
    .limit(1);
  if (!provider) return NextResponse.json({ error: 'Provider not found in this tenant.' }, { status: 404 });
  const vehicleId = typeof body.vehicleId === 'string' && body.vehicleId.trim() ? body.vehicleId.trim() : null;
  if (instrumentId) {
    const validation = await validateFleetPaymentInstrument({
      tenantId: session.tenantId,
      instrumentId,
      vehicleId,
      at: transactionAt,
    });
    if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 422 });
  }
  let assignmentId = typeof body.assignmentId === 'string' && body.assignmentId.trim() ? body.assignmentId.trim() : null;
  if (!assignmentId && instrumentId) {
    const [assignment] = await db
      .select({ id: fleetPaymentAssignments.id })
      .from(fleetPaymentAssignments)
      .where(
        and(
          eq(fleetPaymentAssignments.tenantId, session.tenantId),
          eq(fleetPaymentAssignments.instrumentId, instrumentId),
          eq(fleetPaymentAssignments.status, 'assigned'),
        ),
      )
      .orderBy(desc(fleetPaymentAssignments.assignedAt))
      .limit(1);
    assignmentId = assignment?.id ?? null;
  }
  const id = randomUUID();
  await db.insert(fleetPaymentTransactions).values({
    id,
    tenantId: session.tenantId,
    providerId,
    instrumentId,
    assignmentId,
    tripId: typeof body.tripId === 'string' && body.tripId.trim() ? body.tripId.trim() : null,
    vehicleId,
    driverEmployeeId:
      typeof body.driverEmployeeId === 'string' && body.driverEmployeeId.trim() ? body.driverEmployeeId.trim() : null,
    externalDriverId:
      typeof body.externalDriverId === 'string' && body.externalDriverId.trim() ? body.externalDriverId.trim() : null,
    externalTransactionId:
      typeof body.externalTransactionId === 'string' && body.externalTransactionId.trim()
        ? body.externalTransactionId.trim()
        : null,
    transactionAt,
    merchant: typeof body.merchant === 'string' ? body.merchant.trim() || null : null,
    location: typeof body.location === 'string' ? body.location.trim() || null : null,
    category,
    litres:
      body.litres !== undefined && body.litres !== null && body.litres !== '' ? Number(body.litres).toFixed(2) : null,
    unitPrice:
      body.unitPrice !== undefined && body.unitPrice !== null && body.unitPrice !== ''
        ? Number(body.unitPrice).toFixed(3)
        : null,
    amount: amount.toFixed(2),
    currency: typeof body.currency === 'string' && body.currency.trim() ? body.currency.trim().toUpperCase() : 'NAD',
    odometerReading:
      body.odometerReading !== undefined && body.odometerReading !== null && body.odometerReading !== ''
        ? Number(body.odometerReading)
        : null,
    status,
    source,
    reconciliationStatus,
    reconciliationConfidence:
      body.reconciliationConfidence !== undefined && body.reconciliationConfidence !== null
        ? Math.max(0, Math.min(100, Number(body.reconciliationConfidence)))
        : null,
    matchedExpenseId:
      typeof body.matchedExpenseId === 'string' && body.matchedExpenseId.trim() ? body.matchedExpenseId.trim() : null,
    matchedFuelTransactionId:
      typeof body.matchedFuelTransactionId === 'string' && body.matchedFuelTransactionId.trim()
        ? body.matchedFuelTransactionId.trim()
        : null,
    rawData: typeof body.rawData === 'object' && body.rawData ? (body.rawData as Record<string, unknown>) : {},
    importedByUserId: session.user.id,
  });
  const [created] = await db.select().from(fleetPaymentTransactions).where(eq(fleetPaymentTransactions.id, id)).limit(1);
  return NextResponse.json({ success: true, data: created }, { status: 201 });
}
