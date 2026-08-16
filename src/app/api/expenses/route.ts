import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { operationalExpenses, OPERATIONAL_EXPENSE_CATEGORIES } from '@/db/schema/operational-expenses';
import { trips } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { tripScopeCondition } from '@/lib/record-scope';
import { runAtomicMutations } from '@/lib/db-atomic';

function parseDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function permissionsFor(session: Parameters<typeof hasPermission>[0]) {
  const [fuelManage, tripManage, fuelVerify, driverLog] = await Promise.all([
    hasPermission(session, Permissions.FUEL_MANAGE),
    hasPermission(session, Permissions.TRIP_MANAGE),
    hasPermission(session, Permissions.FUEL_VERIFY),
    hasPermission(session, Permissions.DRIVER_LOG_CREATE),
  ]);
  return {
    canManage: fuelManage || tripManage,
    canViewRegister: fuelManage || tripManage || fuelVerify,
    canDriverRecord: driverLog,
  };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await permissionsFor(session);
    if (!permission.canViewRegister) {
      return NextResponse.json({ error: 'Expense register access is restricted to Transport Office' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() || '';
    const category = searchParams.get('category')?.trim() || '';
    const vehicleId = searchParams.get('vehicleId')?.trim() || '';
    const tripId = searchParams.get('tripId')?.trim() || '';
    const verificationStatus = searchParams.get('verificationStatus')?.trim() || '';
    const from = parseDate(searchParams.get('from'));
    const to = parseDate(searchParams.get('to'), true);
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 250);

    const conditions = [eq(operationalExpenses.tenantId, session.tenantId)];
    if (category) conditions.push(eq(operationalExpenses.category, category));
    if (vehicleId) conditions.push(eq(operationalExpenses.vehicleId, vehicleId));
    if (tripId) conditions.push(eq(operationalExpenses.tripId, tripId));
    if (verificationStatus) conditions.push(eq(operationalExpenses.verificationStatus, verificationStatus));
    if (from) conditions.push(gte(operationalExpenses.transactionAt, from));
    if (to) conditions.push(lte(operationalExpenses.transactionAt, to));
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(operationalExpenses.supplier, term),
          ilike(operationalExpenses.referenceNumber, term),
          ilike(operationalExpenses.notes, term),
          ilike(vehicles.licenceNumber, term),
          ilike(vehicles.vehicleRegisterNumber, term),
          ilike(transportRequests.reference, term),
        )!,
      );
    }

    const db = getDb();
    const rows = await db
      .select({
        id: operationalExpenses.id,
        tripId: operationalExpenses.tripId,
        vehicleId: operationalExpenses.vehicleId,
        category: operationalExpenses.category,
        supplier: operationalExpenses.supplier,
        transactionAt: operationalExpenses.transactionAt,
        referenceNumber: operationalExpenses.referenceNumber,
        amount: operationalExpenses.amount,
        currency: operationalExpenses.currency,
        odometerReading: operationalExpenses.odometerReading,
        receiptKey: operationalExpenses.receiptKey,
        verificationStatus: operationalExpenses.verificationStatus,
        notes: operationalExpenses.notes,
        createdAt: operationalExpenses.createdAt,
        vehicleLicence: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        tripReference: transportRequests.reference,
      })
      .from(operationalExpenses)
      .innerJoin(
        vehicles,
        and(eq(operationalExpenses.vehicleId, vehicles.id), eq(vehicles.tenantId, session.tenantId)),
      )
      .leftJoin(trips, eq(operationalExpenses.tripId, trips.id))
      .leftJoin(
        transportRequests,
        and(eq(trips.requestId, transportRequests.id), eq(transportRequests.tenantId, session.tenantId)),
      )
      .where(and(...conditions))
      .orderBy(desc(operationalExpenses.transactionAt))
      .limit(limit);

    return NextResponse.json({
      success: true,
      data: rows,
      categories: OPERATIONAL_EXPENSE_CATEGORIES,
    });
  } catch (error) {
    console.error('[expenses] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load expense register' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await permissionsFor(session);
    if (!permission.canManage && !permission.canDriverRecord) {
      return NextResponse.json({ error: 'You are not allowed to record operational expenses' }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const category = String(body.category || '').trim();
    const amount = Number(body.amount);
    const tripId = typeof body.tripId === 'string' && body.tripId.trim() ? body.tripId.trim() : null;
    let vehicleId = typeof body.vehicleId === 'string' && body.vehicleId.trim() ? body.vehicleId.trim() : null;
    const clientSyncId = typeof body.clientSyncId === 'string' && body.clientSyncId.trim() ? body.clientSyncId.trim() : null;

    if (!OPERATIONAL_EXPENSE_CATEGORIES.includes(category as (typeof OPERATIONAL_EXPENSE_CATEGORIES)[number])) {
      return NextResponse.json({ error: 'Select a valid expense category' }, { status: 422 });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Enter a positive expense amount' }, { status: 422 });
    }
    if (!tripId && !permission.canManage) {
      return NextResponse.json({ error: 'Drivers can record expenses only against their own active trip' }, { status: 422 });
    }

    const occurredAt = body.transactionAt ? new Date(String(body.transactionAt)) : new Date();
    if (Number.isNaN(occurredAt.getTime()) || occurredAt.getTime() > Date.now() + 5 * 60 * 1000) {
      return NextResponse.json({ error: 'Enter a valid transaction date and time' }, { status: 422 });
    }
    const currency = String(body.currency || 'NAD').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      return NextResponse.json({ error: 'Currency must use a three-letter code' }, { status: 422 });
    }
    const odometer = body.odometerReading === '' || body.odometerReading === null || body.odometerReading === undefined
      ? null
      : Number(body.odometerReading);
    if (odometer !== null && (!Number.isInteger(odometer) || odometer < 0)) {
      return NextResponse.json({ error: 'Odometer must be a positive whole number' }, { status: 422 });
    }

    const db = getDb();
    let tripContext: { vehicleId: string; status: string } | null = null;
    if (tripId) {
      const tripConditions = [eq(trips.id, tripId), eq(trips.tenantId, session.tenantId)];
      if (!permission.canManage) {
        tripConditions.push(
          tripScopeCondition({
            tenantId: session.tenantId,
            userId: session.user.id,
            recordScope: 'assigned',
          }),
        );
      }
      const [row] = await db
        .select({ vehicleId: trips.vehicleId, status: trips.status })
        .from(trips)
        .where(and(...tripConditions))
        .limit(1);
      if (!row) return NextResponse.json({ error: 'Trip not found or not assigned to you' }, { status: 404 });
      if (row.status === 'closed') {
        return NextResponse.json(
          { error: 'This trip is already reconciled and closed. Trip-linked expenses can no longer be added.' },
          { status: 409 },
        );
      }
      if (!permission.canManage && !['in_progress', 'return_due'].includes(row.status)) {
        return NextResponse.json({ error: 'Driver expenses are available only while the trip is active' }, { status: 409 });
      }
      tripContext = row;
      vehicleId = row.vehicleId;
    }

    if (!vehicleId) {
      return NextResponse.json({ error: 'Select a vehicle for this expense' }, { status: 422 });
    }
    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);
    if (!vehicle) return NextResponse.json({ error: 'Vehicle not found in this tenant' }, { status: 404 });

    if (clientSyncId) {
      const [existing] = await db
        .select()
        .from(operationalExpenses)
        .where(and(eq(operationalExpenses.tenantId, session.tenantId), eq(operationalExpenses.clientSyncId, clientSyncId)))
        .limit(1);
      if (existing) return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
    }

    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
      .limit(1);

    const expenseId = randomUUID();
    await runAtomicMutations((executor) => [
      executor.insert(operationalExpenses).values({
        id: expenseId,
        tenantId: session.tenantId,
        tripId,
        vehicleId,
        clientSyncId,
        category,
        supplier: body.supplier ? String(body.supplier).trim() : null,
        transactionAt: occurredAt,
        referenceNumber: body.referenceNumber ? String(body.referenceNumber).trim() : null,
        amount: amount.toFixed(2),
        currency,
        odometerReading: odometer,
        receiptKey: body.receiptKey ? String(body.receiptKey).trim() : null,
        verificationStatus: 'awaiting_verification',
        notes: body.notes ? String(body.notes).trim() : null,
        enteredByUserId: session.user.id,
      }),
      executor.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: tripId ? 'trip_expense_created' : 'vehicle_expense_created',
        actorUserId: session.user.id,
        actorEmployeeId: employee?.id,
        action: 'create',
        entityType: 'trip_expense',
        entityId: expenseId,
        summary: `${category.replaceAll('_', ' ')} expense recorded — ${currency} ${amount.toFixed(2)}`,
        after: { tripId, vehicleId, category, amount: amount.toFixed(2), currency },
        sourceChannel: clientSyncId ? 'offline_sync' : 'web',
      }),
    ]);

    const [expense] = await db
      .select()
      .from(operationalExpenses)
      .where(eq(operationalExpenses.id, expenseId))
      .limit(1);
    if (!expense) throw new Error('Expense committed but could not be reloaded');
    return NextResponse.json({ success: true, data: expense }, { status: 201 });
  } catch (error) {
    console.error('[expenses] POST failed:', error);
    if (String(error).includes('closed_trip_financial_immutable')) {
      return NextResponse.json(
        { error: 'This trip was closed while the expense was being recorded. Closed-trip financial data is immutable.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to record operational expense' }, { status: 500 });
  }
}
