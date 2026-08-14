import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { fuelReceipts, fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

function parseDate(value: string | null, endOfDay = false) {
  if (!value) return null;
  const parsed = new Date(endOfDay ? `${value}T23:59:59.999` : `${value}T00:00:00.000`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const [canManage, canVerify] = await Promise.all([
      hasPermission(session, Permissions.FUEL_MANAGE),
      hasPermission(session, Permissions.FUEL_VERIFY),
    ]);
    if (!canManage && !canVerify) {
      return NextResponse.json({ error: 'Receipt register access is restricted to Transport Office' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search')?.trim() || '';
    const vehicleId = searchParams.get('vehicleId')?.trim() || '';
    const driverEmployeeId = searchParams.get('driverEmployeeId')?.trim() || '';
    const station = searchParams.get('station')?.trim() || '';
    const ocrStatus = searchParams.get('ocrStatus')?.trim() || '';
    const verification = searchParams.get('verification')?.trim() || '';
    const from = parseDate(searchParams.get('from'));
    const to = parseDate(searchParams.get('to'), true);
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 100), 1), 250);

    const conditions = [eq(fuelReceipts.tenantId, session.tenantId)];
    if (vehicleId) conditions.push(eq(fuelTransactions.vehicleId, vehicleId));
    if (driverEmployeeId) conditions.push(eq(fuelTransactions.driverEmployeeId, driverEmployeeId));
    if (station) conditions.push(ilike(fuelTransactions.stationName, `%${station}%`));
    if (ocrStatus) conditions.push(eq(fuelReceipts.ocrStatus, ocrStatus));
    if (verification === 'verified') conditions.push(eq(fuelReceipts.isVerified, true));
    if (verification === 'unverified') conditions.push(eq(fuelReceipts.isVerified, false));
    if (from) conditions.push(gte(fuelTransactions.transactionAt, from));
    if (to) conditions.push(lte(fuelTransactions.transactionAt, to));
    if (search) {
      const term = `%${search}%`;
      conditions.push(
        or(
          ilike(fuelReceipts.originalFileName, term),
          ilike(fuelTransactions.stationName, term),
          ilike(fuelTransactions.referenceNumber, term),
          ilike(vehicles.licenceNumber, term),
          ilike(vehicles.vehicleRegisterNumber, term),
          ilike(employees.firstName, term),
          ilike(employees.lastName, term),
        )!,
      );
    }

    const db = getDb();
    const rows = await db
      .select({
        id: fuelReceipts.id,
        transactionId: fuelReceipts.transactionId,
        originalFileName: fuelReceipts.originalFileName,
        mimeType: fuelReceipts.mimeType,
        fileSize: fuelReceipts.fileSize,
        ocrStatus: fuelReceipts.ocrStatus,
        extractionConfidence: fuelReceipts.extractionConfidence,
        extractionData: fuelReceipts.extractionData,
        isVerified: fuelReceipts.isVerified,
        createdAt: fuelReceipts.createdAt,
        transactionAt: fuelTransactions.transactionAt,
        stationName: fuelTransactions.stationName,
        referenceNumber: fuelTransactions.referenceNumber,
        amount: fuelTransactions.amount,
        litres: fuelTransactions.litres,
        fuelType: fuelTransactions.fuelType,
        anomalyState: fuelTransactions.anomalyState,
        transactionVerified: fuelTransactions.isVerified,
        vehicleId: fuelTransactions.vehicleId,
        vehicleLicence: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        driverEmployeeId: fuelTransactions.driverEmployeeId,
        driverFirstName: employees.firstName,
        driverLastName: employees.lastName,
      })
      .from(fuelReceipts)
      .innerJoin(fuelTransactions, eq(fuelReceipts.transactionId, fuelTransactions.id))
      .innerJoin(
        vehicles,
        and(eq(fuelTransactions.vehicleId, vehicles.id), eq(vehicles.tenantId, session.tenantId)),
      )
      .leftJoin(
        employees,
        and(eq(fuelTransactions.driverEmployeeId, employees.id), eq(employees.tenantId, session.tenantId)),
      )
      .where(and(...conditions))
      .orderBy(desc(fuelTransactions.transactionAt), desc(fuelReceipts.createdAt))
      .limit(limit);

    return NextResponse.json({ success: true, data: rows });
  } catch (error) {
    console.error('[fuel/receipts/register] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load receipt register' }, { status: 500 });
  }
}
