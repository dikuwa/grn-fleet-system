import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { fuelReceipts, fuelTransactions } from '@/db/schema/trips';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { fuelScopeCondition } from '@/lib/record-scope';
import { getSignedFileUrl, isStorageConfigured } from '@/lib/storage';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const { id } = await params;

    const [canManage, canVerify, canDriverFuel] = await Promise.all([
      hasPermission(session, Permissions.FUEL_MANAGE),
      hasPermission(session, Permissions.FUEL_VERIFY),
      hasPermission(session, Permissions.DRIVER_FUEL_CREATE),
    ]);
    if (!canManage && !canVerify && !canDriverFuel) {
      return NextResponse.json({ error: 'You are not allowed to view receipt evidence' }, { status: 403 });
    }
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'Secure receipt storage is not configured' }, { status: 503 });
    }
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Receipt evidence not found' }, { status: 404 });
    }

    const scope = canManage || canVerify
      ? fuelScopeCondition({ tenantId: session.tenantId, userId: session.user.id, recordScope: 'tenant' })
      : fuelScopeCondition({ tenantId: session.tenantId, userId: session.user.id, recordScope: 'assigned' });

    const db = getDb();
    const [record] = await db
      .select({
        id: fuelReceipts.id,
        fileKey: fuelReceipts.fileKey,
        originalFileName: fuelReceipts.originalFileName,
        mimeType: fuelReceipts.mimeType,
      })
      .from(fuelReceipts)
      .innerJoin(fuelTransactions, eq(fuelReceipts.transactionId, fuelTransactions.id))
      .where(and(eq(fuelReceipts.id, id), eq(fuelReceipts.tenantId, session.tenantId), scope))
      .limit(1);

    if (!record) return NextResponse.json({ error: 'Receipt evidence not found' }, { status: 404 });
    const url = await getSignedFileUrl(record.fileKey, 10 * 60);
    if (!url) return NextResponse.json({ error: 'Receipt evidence is unavailable' }, { status: 503 });

    return NextResponse.json({
      success: true,
      data: {
        id: record.id,
        originalFileName: record.originalFileName,
        mimeType: record.mimeType,
        url,
        expiresInSeconds: 600,
      },
    });
  } catch (error) {
    console.error('[fuel/receipts/evidence] GET failed:', error);
    return NextResponse.json({ error: 'Failed to open receipt evidence' }, { status: 500 });
  }
}
