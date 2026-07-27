import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fuelTransactions, trips, vehicleAllocations } from '@/db/schema/trips';
import { vehicles, vehicleOdometerEvents } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { notifications } from '@/db/schema/notifications';
import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

/**
 * GET /api/fuel
 * List fuel transactions for the authenticated tenant.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const { session } = auth;
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const db = getDb();

    const rows = await db
      .select({
        id: fuelTransactions.id,
        transactionAt: fuelTransactions.transactionAt,
        stationName: fuelTransactions.stationName,
        fuelType: fuelTransactions.fuelType,
        litres: fuelTransactions.litres,
        amount: fuelTransactions.amount,
        paymentMethod: fuelTransactions.paymentMethod,
        anomalyState: fuelTransactions.anomalyState,
        isVerified: fuelTransactions.isVerified,
        vehicleId: fuelTransactions.vehicleId,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
      })
      .from(fuelTransactions)
      .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(eq(vehicles.tenantId, session.tenantId)))
      .orderBy(desc(fuelTransactions.transactionAt))
      .limit(limit)
      .offset(offset);

    const [totalResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(fuelTransactions)
      .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(eq(vehicles.tenantId, session.tenantId));

    return NextResponse.json({
      success: true,
      data: { transactions: rows, total: Number(totalResult?.count ?? 0) },
    });
  } catch (error) {
    console.error('[fuel] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch fuel transactions' }, { status: 500 });
  }
}

/**
 * POST /api/fuel
 * Create a fuel transaction.
 * Requires fuel:manage or driver:fuel-create permission.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;

    const { session } = auth;

    // Check permission — either fuel manager or driver recording fuel
    const managerCheck = await requirePermission(session, Permissions.FUEL_MANAGE);
    const isManager = !(managerCheck instanceof NextResponse);
    if (!isManager) {
      const driverPerm = await requirePermission(session, Permissions.DRIVER_FUEL_CREATE);
      if (driverPerm instanceof NextResponse) return driverPerm;
    }

    const body = await req.json();
    const {
      tripId,
      tripRef,
      vehicleId,
      vehicleGrn,
      transactionAt,
      stationName,
      fuelType,
      litres,
      amount,
      paymentMethod,
      odometerReading,
      referenceNumber,
      fillType,
      clientSyncId,
    } = body;

    if ((!vehicleId && !vehicleGrn) || !fuelType || !litres || !amount || !paymentMethod) {
      return NextResponse.json(
        { error: 'Missing required fields: vehicleId, fuelType, litres, amount, paymentMethod' },
        { status: 400 },
      );
    }

    const db = getDb();

    let resolvedVehicleId = vehicleId as string | undefined;
    let resolvedTripId = tripId as string | undefined;
    if (!resolvedVehicleId && vehicleGrn) {
      const [byGrn] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(
          and(
            eq(vehicles.tenantId, session.tenantId),
            eq(vehicles.licenceNumber, String(vehicleGrn)),
          ),
        )
        .limit(1);
      resolvedVehicleId = byGrn?.id;
    }
    if (!resolvedTripId && tripRef) {
      const [byReference] = await db
        .select({ id: trips.id })
        .from(trips)
        .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
        .where(
          and(
            eq(trips.tenantId, session.tenantId),
            eq(transportRequests.reference, String(tripRef)),
          ),
        )
        .limit(1);
      resolvedTripId = byReference?.id;
    }

    // Verify the vehicle belongs to this tenant
    const [vehicle] = await db
      .select({ id: vehicles.id, currentOdometer: vehicles.currentOdometer })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.id, resolvedVehicleId || '00000000-0000-0000-0000-000000000000'),
          eq(vehicles.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found in your tenant' }, { status: 404 });
    }

    const litresNumber = Number(litres);
    const amountNumber = Number(amount);
    const odometerNumber =
      odometerReading === null || odometerReading === undefined || odometerReading === ''
        ? null
        : Number(odometerReading);
    if (
      !Number.isFinite(litresNumber) ||
      litresNumber <= 0 ||
      !Number.isFinite(amountNumber) ||
      amountNumber <= 0
    ) {
      return NextResponse.json(
        { error: 'Litres and amount must be positive numbers' },
        { status: 422 },
      );
    }
    if (
      odometerNumber !== null &&
      (!Number.isInteger(odometerNumber) || odometerNumber < vehicle.currentOdometer)
    ) {
      return NextResponse.json(
        { error: `Odometer cannot be lower than the current reading (${vehicle.currentOdometer})` },
        { status: 422 },
      );
    }

    if (!isManager) {
      if (!resolvedTripId)
        return NextResponse.json(
          { error: 'Drivers must record fuel against an assigned active trip' },
          { status: 422 },
        );
      const [employee] = await db
        .select({ id: employees.id })
        .from(employees)
        .where(
          and(
            eq(employees.tenantId, session.tenantId),
            eq(employees.userId, session.user.id),
            eq(employees.employmentStatus, 'active'),
          ),
        )
        .limit(1);
      if (!employee)
        return NextResponse.json(
          { error: 'Your login is not linked to an active employee record' },
          { status: 403 },
        );
      const [assignedTrip] = await db
        .select({ id: trips.id })
        .from(trips)
        .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .where(
          and(
            eq(trips.id, resolvedTripId),
            eq(trips.tenantId, session.tenantId),
            eq(trips.vehicleId, resolvedVehicleId!),
            eq(vehicleAllocations.driverEmployeeId, employee.id),
            inArray(trips.status, ['in_progress', 'return_due']),
          ),
        )
        .limit(1);
      if (!assignedTrip)
        return NextResponse.json(
          { error: 'Trip is not active and assigned to this driver and vehicle' },
          { status: 403 },
        );
    } else if (resolvedTripId) {
      const [tenantTrip] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(
          and(
            eq(trips.id, resolvedTripId),
            eq(trips.tenantId, session.tenantId),
            eq(trips.vehicleId, resolvedVehicleId!),
          ),
        )
        .limit(1);
      if (!tenantTrip)
        return NextResponse.json(
          { error: 'Trip does not match this tenant and vehicle' },
          { status: 422 },
        );
    }

    if (clientSyncId && resolvedTripId) {
      const [existing] = await db
        .select()
        .from(fuelTransactions)
        .where(
          and(
            eq(fuelTransactions.tripId, resolvedTripId),
            eq(fuelTransactions.clientSyncId, clientSyncId),
          ),
        )
        .limit(1);
      if (existing) return NextResponse.json({ success: true, data: existing, idempotent: true });
    }

    const [transaction] = await db
      .insert(fuelTransactions)
      .values({
        tripId: resolvedTripId || null,
        clientSyncId: clientSyncId || null,
        vehicleId: resolvedVehicleId!,
        transactionAt: transactionAt ? new Date(transactionAt) : new Date(),
        stationName: stationName || null,
        fuelType,
        litres: String(litresNumber),
        amount: String(amountNumber),
        odometerReading: odometerNumber,
        referenceNumber: referenceNumber || null,
        paymentMethod,
        fillType: fillType || 'full',
        recordedByUserId: session.user.id,
      })
      .returning();

    if (odometerNumber !== null) {
      await db
        .insert(vehicleOdometerEvents)
        .values({
          vehicleId: resolvedVehicleId!,
          odometerValue: odometerNumber,
          source: 'fuel',
          sourceEntityType: 'fuel_transaction',
          sourceEntityId: transaction.id,
          recordedByUserId: session.user.id,
        });
      await db
        .update(vehicles)
        .set({ currentOdometer: odometerNumber, updatedAt: new Date() })
        .where(and(eq(vehicles.id, resolvedVehicleId!), eq(vehicles.tenantId, session.tenantId)));
    }

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0,
      eventType: 'fuel_created',
      actorUserId: session.user.id,
      action: 'create',
      entityType: 'fuel_transaction',
      entityId: transaction.id,
      summary: `Fuel: ${litres}L of ${fuelType} at ${stationName || 'unknown station'} — ${amount}`,
      sourceChannel: clientSyncId ? 'offline_sync' : 'web',
    });

    await db
      .insert(notifications)
      .values({
        tenantId: session.tenantId,
        recipientUserId: session.user.id,
        type: 'fuel_created',
        title: `Fuel Entry Recorded — ${litres}L`,
        body: `${litres}L of ${fuelType} at ${stationName || 'unknown station'} — N$${amount}.`,
        entityType: 'fuel_transaction',
        entityId: transaction.id,
        actionUrl: '/dashboard/fuel',
        priority: 'normal',
      });

    return NextResponse.json({ success: true, data: transaction });
  } catch (error) {
    console.error('[fuel] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create fuel transaction' }, { status: 500 });
  }
}

/**
 * PATCH /api/fuel
 * Verify or reject a tenant-scoped fuel transaction.
 */
export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permission = await requirePermission(session, Permissions.FUEL_VERIFY);
    if (permission instanceof NextResponse) return permission;

    const body = (await req.json()) as {
      transactionId?: string;
      action?: 'verify' | 'reject';
      reason?: string;
    };
    if (!body.transactionId || !['verify', 'reject'].includes(body.action || '')) {
      return NextResponse.json(
        { error: 'Transaction and a verify or reject action are required' },
        { status: 400 },
      );
    }
    const action = body.action as 'verify' | 'reject';
    if (action === 'reject' && !body.reason?.trim()) {
      return NextResponse.json({ error: 'A rejection reason is required' }, { status: 422 });
    }

    const db = getDb();
    const [transaction] = await db
      .select({
        id: fuelTransactions.id,
        isVerified: fuelTransactions.isVerified,
        anomalyState: fuelTransactions.anomalyState,
      })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(
        and(eq(fuelTransactions.id, body.transactionId), eq(vehicles.tenantId, session.tenantId)),
      )
      .limit(1);
    if (!transaction) {
      return NextResponse.json({ error: 'Fuel transaction not found' }, { status: 404 });
    }

    const isVerified = action === 'verify';
    const [updated] = await db
      .update(fuelTransactions)
      .set({
        isVerified,
        verifiedByUserId: session.user.id,
        anomalyState: isVerified ? 'verified' : 'rejected',
        anomalyNotes: body.reason?.trim() || null,
        updatedAt: new Date(),
      })
      .where(eq(fuelTransactions.id, transaction.id))
      .returning();

    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: `fuel_${action}`,
      actorUserId: session.user.id,
      action,
      entityType: 'fuel_transaction',
      entityId: transaction.id,
      before: {
        isVerified: transaction.isVerified,
        anomalyState: transaction.anomalyState,
      },
      after: {
        isVerified: updated.isVerified,
        anomalyState: updated.anomalyState,
      },
      reason: body.reason?.trim() || null,
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[fuel] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to review fuel transaction' }, { status: 500 });
  }
}
