import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, desc, sql } from 'drizzle-orm';
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
      .where(
        and(
          eq(vehicles.tenantId, session.tenantId),
        ),
      )
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
    const permCheck = await requirePermission(session, Permissions.FUEL_MANAGE);
    if (permCheck instanceof NextResponse) {
      const driverPerm = await requirePermission(session, Permissions.DRIVER_FUEL_CREATE);
      if (driverPerm instanceof NextResponse) return driverPerm;
    }

    const body = await req.json();
    const { vehicleId, transactionAt, stationName, fuelType, litres, amount, paymentMethod, odometerReading, referenceNumber, fillType } = body;

    if (!fuelType || !litres || !amount || !paymentMethod) {
      return NextResponse.json(
        { error: 'Missing required fields: fuelType, litres, amount, paymentMethod' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify the vehicle belongs to this tenant
    const [vehicle] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!vehicle && vehicleId) {
      return NextResponse.json({ error: 'Vehicle not found in your tenant' }, { status: 404 });
    }

    const [transaction] = await db
      .insert(fuelTransactions)
      .values({
        vehicleId: vehicleId || null,
        transactionAt: transactionAt ? new Date(transactionAt) : new Date(),
        stationName: stationName || null,
        fuelType,
        litres: String(litres),
        amount: String(amount),
        odometerReading: odometerReading ? Number(odometerReading) : null,
        referenceNumber: referenceNumber || null,
        paymentMethod,
        fillType: fillType || 'full',
        recordedByUserId: session.user.id,
      })
      .returning();

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
      sourceChannel: 'web',
    });

    // Notify the user who recorded the fuel entry
    try {
      const notifRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/notifications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: session.tenantId,
          recipientUserId: session.user.id,
          recipientEmail: session.user.email,
          recipientName: session.user.name || session.user.email,
          type: 'fuel_created',
          title: `⛽ Fuel Entry Recorded — ${litres}L`,
          body: `${litres}L of ${fuelType} at ${stationName || 'unknown station'} — N$${amount}. Vehicle: ${vehicleId || 'N/A'}.`,
          entityType: 'fuel_transaction',
          entityId: transaction.id,
          actionUrl: `/dashboard/fuel`,
          priority: 'normal',
        }),
      });
      if (!notifRes.ok) console.warn('[fuel] Notification delivery failed:', await notifRes.text().catch(() => 'unknown'));
    } catch (notifErr) {
      console.warn('[fuel] Notification error (non-fatal):', notifErr);
    }

    return NextResponse.json({ success: true, data: transaction });
  } catch (error) {
    console.error('[fuel] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create fuel transaction' }, { status: 500 });
  }
}
