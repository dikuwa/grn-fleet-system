import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fuelTransactions, reimbursements } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq } from 'drizzle-orm';
import { getServerSessionFromRequest } from '@/lib/session';

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();

    // Get authenticated user session (fall back to body values for dev)
    const session = await getServerSessionFromRequest(request);
    const recordedByUserId = session?.user?.id || body.recordedByUserId || 'system';
    const tenantId = session?.tenantId || body.tenantId;

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Missing tenantId. Ensure you are logged in or provide a tenantId.' },
        { status: 400 },
      );
    }

    const {
      vehicleGrn,
      vehicleId,
      tripId,
      transactionAt,
      stationName,
      fuelType,
      litres,
      amount,
      odometerReading,
      referenceNumber,
      paymentMethod,
      fillType,
      employeeNumber,
    } = body;

    if (!fuelType || !litres || !amount || !paymentMethod || !recordedByUserId || !tenantId) {
      return NextResponse.json(
        { error: 'Missing required fields: fuelType, litres, amount, paymentMethod, recordedByUserId, tenantId' },
        { status: 400 },
      );
    }

    // Resolve vehicle ID from GRN number or UUID
    let resolvedVehicleId = vehicleId;
    if (!resolvedVehicleId && vehicleGrn) {
      const [v] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(eq(vehicles.grnNumber, vehicleGrn))
        .limit(1);
      if (v) resolvedVehicleId = v.id;
    }

    if (!resolvedVehicleId) {
      return NextResponse.json(
        { error: 'Vehicle not found. Provide a valid vehicleId UUID or vehicleGrn number.' },
        { status: 404 },
      );
    }

    const [transaction] = await db
      .insert(fuelTransactions)
      .values({
        tripId: tripId || null,
        vehicleId: resolvedVehicleId,
        transactionAt: transactionAt ? new Date(transactionAt) : new Date(),
        stationName: stationName || null,
        fuelType,
        litres: litres.toString(),
        amount: amount.toString(),
        odometerReading: odometerReading ? parseInt(odometerReading, 10) : null,
        referenceNumber: referenceNumber || null,
        paymentMethod,
        fillType: fillType || 'full',
        recordedByUserId,
        anomalyState: 'none',
        isVerified: false,
      })
      .returning();

    // If payment method is personal_reimbursement, auto-create reimbursement
    if (paymentMethod === 'personal_reimbursement' && transaction) {
      // Resolve claimant employee ID — priority:
      // 1. Provided employeeNumber → look up by employee number
      // 2. Session user ID → look up by employees.userId
      // 3. Fall back to recordedByUserId (auth user UUID — may not match employee table)
      let claimantEmployeeId = recordedByUserId;

      if (employeeNumber) {
        const [emp] = await db
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.employeeNumber, employeeNumber))
          .limit(1);
        if (emp) claimantEmployeeId = emp.id;
      } else if (session?.user?.id) {
        // Look up employee linked to this auth user
        const [emp] = await db
          .select({ id: employees.id })
          .from(employees)
          .where(eq(employees.userId, session.user.id))
          .limit(1);
        if (emp) claimantEmployeeId = emp.id;
      }

      await db.insert(reimbursements).values({
        transactionId: transaction.id,
        claimantEmployeeId: claimantEmployeeId as string,
        amount: amount.toString(),
        state: 'pending',
      });
    }

    return NextResponse.json({
      success: true,
      data: transaction,
    });
  } catch (error) {
    console.error('Fuel transaction creation failed:', error);
    return NextResponse.json(
      { error: 'Failed to create fuel transaction: ' + String(error) },
      { status: 500 },
    );
  }
}
