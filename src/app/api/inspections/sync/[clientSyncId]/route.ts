import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicleInspections } from '@/db/schema/trips';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const MAX_SYNC_ID_LENGTH = 128;

/**
 * GET /api/inspections/sync/[clientSyncId]
 *
 * Recover an official inspection created by a concurrent retry of the same
 * offline draft. The lookup is tenant-scoped and restricted to the inspector
 * who created the record, so the idempotency token cannot be used to browse
 * another user's inspection evidence.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ clientSyncId: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(
      session,
      '/dashboard/inspections/new',
      'create',
    );
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permissionCheck = await requirePermission(session, Permissions.INSPECTION_PERFORM);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { clientSyncId } = await params;
    const syncId = decodeURIComponent(clientSyncId || '').trim();
    if (!syncId || syncId.length > MAX_SYNC_ID_LENGTH) {
      return NextResponse.json({ error: 'Invalid inspection sync identifier' }, { status: 400 });
    }

    const db = getDb();
    const [inspection] = await db
      .select({
        id: vehicleInspections.id,
        tenantId: vehicleInspections.tenantId,
        vehicleId: vehicleInspections.vehicleId,
        tripId: vehicleInspections.tripId,
        type: vehicleInspections.type,
        status: vehicleInspections.status,
        overallPass: vehicleInspections.overallPass,
        clientSyncId: vehicleInspections.clientSyncId,
      })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tenantId, session.tenantId),
          eq(vehicleInspections.inspectorUserId, session.user.id),
          eq(vehicleInspections.clientSyncId, syncId),
        ),
      )
      .limit(1);

    if (!inspection) {
      return NextResponse.json({ error: 'Inspection sync record not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      inspection,
      data: inspection,
      idempotent: true,
    });
  } catch (error) {
    console.error('[inspections/sync] GET failed:', error);
    return NextResponse.json({ error: 'Failed to recover inspection sync record' }, { status: 500 });
  }
}
