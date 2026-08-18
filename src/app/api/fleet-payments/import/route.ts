import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, ilike, lte, or } from 'drizzle-orm';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { getDb } from '@/db';
import {
  fleetPaymentAssignments,
  fleetPaymentInstruments,
  fleetPaymentProviders,
  fleetPaymentTransactions,
} from '@/db/schema/fleet-payments';
import { vehicles } from '@/db/schema/fleet';
import { fuelTransactions, trips, vehicleAllocations } from '@/db/schema/trips';
import { operationalExpenses } from '@/db/schema/operational-expenses';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

type RawRow = Record<string, unknown>;

function normalized(row: RawRow) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')] = value;
  }
  return out;
}

function pick(row: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function parseAmount(value: string) {
  const number = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(number) ? number : NaN;
}

function parseDate(value: string) {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!match) return null;
  const [, day, month, year, hour = '0', minute = '0'] = match;
  const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function parseFile(file: File): Promise<RawRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheet = book.Sheets[book.SheetNames[0]];
    return sheet ? (XLSX.utils.sheet_to_json(sheet, { defval: '' }) as RawRow[]) : [];
  }
  const text = await file.text();
  const result = Papa.parse<RawRow>(text, { header: true, skipEmptyLines: true });
  if (result.errors.length && result.data.length === 0) throw new Error(result.errors[0]?.message || 'Could not parse statement');
  return result.data;
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const access = await Promise.all([
    hasPermission(session, Permissions.TENANT_MANAGE),
    hasPermission(session, Permissions.FUEL_MANAGE),
    hasPermission(session, Permissions.FUEL_VERIFY),
    hasPermission(session, Permissions.TRIP_MANAGE),
  ]);
  if (!access.some(Boolean)) return NextResponse.json({ error: 'Fleet payment statement import is restricted.' }, { status: 403 });

  const form = await request.formData();
  const file = form.get('file');
  const providerId = String(form.get('providerId') || '').trim();
  if (!(file instanceof File) || !providerId) {
    return NextResponse.json({ error: 'Provider and CSV/Excel statement are required.' }, { status: 400 });
  }
  if (file.size > 10 * 1024 * 1024) return NextResponse.json({ error: 'Statement must be 10 MB or smaller.' }, { status: 413 });

  const db = getDb();
  const [provider] = await db
    .select({ id: fleetPaymentProviders.id })
    .from(fleetPaymentProviders)
    .where(and(eq(fleetPaymentProviders.id, providerId), eq(fleetPaymentProviders.tenantId, session.tenantId)))
    .limit(1);
  if (!provider) return NextResponse.json({ error: 'Provider not found in this tenant.' }, { status: 404 });

  let rows: RawRow[];
  try {
    rows = await parseFile(file);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not parse statement.' }, { status: 422 });
  }
  if (rows.length === 0) return NextResponse.json({ error: 'The statement contains no transaction rows.' }, { status: 422 });
  if (rows.length > 5000) return NextResponse.json({ error: 'Import at most 5,000 transactions at a time.' }, { status: 422 });

  const prepared: Array<typeof fleetPaymentTransactions.$inferInsert> = [];
  const rejected: Array<{ row: number; reason: string }> = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = normalized(rows[index]!);
    const externalTransactionId = pick(row, ['transaction_id', 'transaction_reference', 'reference', 'reference_number', 'id']);
    const dateText = pick(row, ['transaction_at', 'transaction_date', 'date_time', 'datetime', 'date']);
    const amount = parseAmount(pick(row, ['amount', 'transaction_amount', 'total', 'value']));
    const transactionAt = parseDate(dateText);
    if (!transactionAt || !Number.isFinite(amount) || amount <= 0) {
      rejected.push({ row: index + 2, reason: 'Missing/invalid transaction date or amount' });
      continue;
    }
    if (externalTransactionId) {
      const [duplicate] = await db
        .select({ id: fleetPaymentTransactions.id })
        .from(fleetPaymentTransactions)
        .where(
          and(
            eq(fleetPaymentTransactions.providerId, providerId),
            eq(fleetPaymentTransactions.externalTransactionId, externalTransactionId),
          ),
        )
        .limit(1);
      if (duplicate) continue;
    }

    const instrumentRef = pick(row, ['instrument_reference', 'card_number', 'card', 'tag_number', 'tag', 'account', 'last4']);
    const vehicleRef = pick(row, ['vehicle', 'vehicle_registration', 'registration', 'grn', 'licence_number', 'license_number']);
    let instrument: { id: string; vehicleId: string | null } | undefined;
    if (instrumentRef) {
      const last4 = instrumentRef.replace(/\s+/g, '').slice(-4);
      [instrument] = await db
        .select({ id: fleetPaymentInstruments.id, vehicleId: fleetPaymentInstruments.vehicleId })
        .from(fleetPaymentInstruments)
        .where(
          and(
            eq(fleetPaymentInstruments.tenantId, session.tenantId),
            eq(fleetPaymentInstruments.providerId, providerId),
            or(
              eq(fleetPaymentInstruments.externalReference, instrumentRef),
              ilike(fleetPaymentInstruments.maskedIdentifier, `%${last4}`),
            ),
          ),
        )
        .limit(1);
    }
    let vehicleId = instrument?.vehicleId ?? null;
    if (!vehicleId && vehicleRef) {
      const [vehicle] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.tenantId, session.tenantId),
            or(eq(vehicles.licenceNumber, vehicleRef), eq(vehicles.vehicleRegisterNumber, vehicleRef)),
          ),
        )
        .limit(1);
      vehicleId = vehicle?.id ?? null;
    }

    let tripId: string | null = null;
    let assignmentId: string | null = null;
    let driverEmployeeId: string | null = null;
    if (vehicleId) {
      const [trip] = await db
        .select({
          id: trips.id,
          allocationId: trips.allocationId,
          driverEmployeeId: vehicleAllocations.driverEmployeeId,
        })
        .from(trips)
        .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .where(
          and(
            eq(trips.tenantId, session.tenantId),
            eq(trips.vehicleId, vehicleId),
            lte(vehicleAllocations.startAt, transactionAt),
            gte(vehicleAllocations.endAt, transactionAt),
          ),
        )
        .limit(1);
      tripId = trip?.id ?? null;
      driverEmployeeId = trip?.driverEmployeeId ?? null;
      if (trip) {
        const [assignment] = await db
          .select({ id: fleetPaymentAssignments.id, instrumentId: fleetPaymentAssignments.instrumentId })
          .from(fleetPaymentAssignments)
          .where(
            and(
              eq(fleetPaymentAssignments.tenantId, session.tenantId),
              eq(fleetPaymentAssignments.allocationId, trip.allocationId),
            ),
          )
          .limit(1);
        assignmentId = assignment?.id ?? null;
        if (!instrument && assignment) {
          [instrument] = await db
            .select({ id: fleetPaymentInstruments.id, vehicleId: fleetPaymentInstruments.vehicleId })
            .from(fleetPaymentInstruments)
            .where(eq(fleetPaymentInstruments.id, assignment.instrumentId))
            .limit(1);
        }
      }
    }

    const dayStart = new Date(transactionAt.getTime() - 12 * 60 * 60 * 1000);
    const dayEnd = new Date(transactionAt.getTime() + 12 * 60 * 60 * 1000);
    const categoryRaw = pick(row, ['category', 'transaction_type', 'product', 'expense_type']).toLowerCase();
    const category = categoryRaw.includes('fuel') || pick(row, ['litres', 'liters', 'volume']) ? 'fuel' : categoryRaw || 'other';
    let matchedFuelTransactionId: string | null = null;
    let matchedExpenseId: string | null = null;
    if (vehicleId && category === 'fuel') {
      const candidates = await db
        .select({ id: fuelTransactions.id, amount: fuelTransactions.amount })
        .from(fuelTransactions)
        .where(
          and(
            eq(fuelTransactions.vehicleId, vehicleId),
            gte(fuelTransactions.transactionAt, dayStart),
            lte(fuelTransactions.transactionAt, dayEnd),
          ),
        );
      matchedFuelTransactionId = candidates.find((candidate) => Math.abs(Number(candidate.amount) - amount) < 0.02)?.id ?? null;
    } else if (vehicleId) {
      const candidates = await db
        .select({ id: operationalExpenses.id, amount: operationalExpenses.amount })
        .from(operationalExpenses)
        .where(
          and(
            eq(operationalExpenses.tenantId, session.tenantId),
            eq(operationalExpenses.vehicleId, vehicleId),
            gte(operationalExpenses.transactionAt, dayStart),
            lte(operationalExpenses.transactionAt, dayEnd),
          ),
        );
      matchedExpenseId = candidates.find((candidate) => Math.abs(Number(candidate.amount) - amount) < 0.02)?.id ?? null;
    }
    const matched = Boolean(matchedFuelTransactionId || matchedExpenseId);
    const likely = !matched && Boolean(tripId && vehicleId);

    prepared.push({
      id: randomUUID(),
      tenantId: session.tenantId,
      providerId,
      instrumentId: instrument?.id ?? null,
      assignmentId,
      tripId,
      vehicleId,
      driverEmployeeId,
      externalTransactionId: externalTransactionId || null,
      transactionAt,
      merchant: pick(row, ['merchant', 'station', 'service_station', 'supplier']) || null,
      location: pick(row, ['location', 'town', 'city']) || null,
      category,
      litres: pick(row, ['litres', 'liters', 'volume']) || null,
      unitPrice: pick(row, ['unit_price', 'price_per_litre', 'price_per_liter']) || null,
      amount: amount.toFixed(2),
      currency: pick(row, ['currency']) || 'NAD',
      odometerReading: pick(row, ['odometer', 'odometer_reading', 'mileage'])
        ? Math.round(Number(pick(row, ['odometer', 'odometer_reading', 'mileage'])))
        : null,
      status: pick(row, ['status', 'transaction_status']).toLowerCase() || 'approved',
      source: 'file_import',
      reconciliationStatus: matched ? 'matched' : likely ? 'likely_match' : 'unmatched',
      reconciliationConfidence: matched ? 100 : likely ? 80 : 0,
      matchedExpenseId,
      matchedFuelTransactionId,
      rawData: row,
      importedByUserId: session.user.id,
    });
  }

  if (prepared.length) {
    await db.insert(fleetPaymentTransactions).values(prepared).onConflictDoNothing();
  }
  const counts = prepared.reduce(
    (acc, item) => {
      acc[item.reconciliationStatus as 'matched' | 'likely_match' | 'unmatched'] += 1;
      return acc;
    },
    { matched: 0, likely_match: 0, unmatched: 0 },
  );
  return NextResponse.json({
    success: true,
    data: { imported: prepared.length, skippedOrRejected: rows.length - prepared.length, rejected, ...counts },
  });
}
