import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const MAX_SYNC_ID_LENGTH = 128;

/**
 * GET /api/fuel/sync/[clientSyncId]
 *
 * Recovery lookup for an offline Fuel POST that lost a concurrent idempotency race.
 * This endpoint never broadens normal Fuel visibility: ordinary users may recover
 * only transactions they personally recorded, while FUEL_MANAGE users may recover
 * any matching transaction inside their own tenant.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientSyncId: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const { clientSyncId } = await params;
    const syncId = decodeURIComponent(clientSyncId || '').trim();
    if (!syncId || syncId.length > MAX_SYNC_ID_LENGTH) {
      return NextResponse.json({ error: 'Invalid fuel sync identifier' }, { status: 400 });
    }

    const canManage = await hasPermission(auth.session, Permissions.FUEL_MANAGE);
    const db = getDb();
    const scopeCondition = canManage
      ? eq(vehicles.tenantId, auth.session.tenantId)
      : and(
          eq(vehicles.tenantId, auth.session.tenantId),
          eq(fuelTransactions.recordedByUserId, auth.session.user.id),
        );

    const [transaction] = await db
      .select({
        id: fuelTransactions.id,
        clientSyncId: fuelTransactions.clientSyncId,
        tripId: fuelTransactions.tripId,
        vehicleId: fuelTransactions.vehicleId,
        transactionAt: fuelTransactions.transactionAt,
        fuelType: fuelTransactions.fuelType,
        litres: fuelTransactions.litres,
        amount: fuelTransactions.amount,
        paymentMethod: fuelTransactions.paymentMethod,
      })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(and(eq(fuelTransactions.clientSyncId, syncId), scopeCondition))
      .limit(1);

    if (!transaction) {
      return NextResponse.json({ error: 'Fuel sync transaction not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: transaction, idempotent: true });
  } catch (error) {
    console.error('[fuel/sync] GET failed:', error);
    return NextResponse.json({ error: 'Failed to recover fuel sync transaction' }, { status: 500 });
  }
}
