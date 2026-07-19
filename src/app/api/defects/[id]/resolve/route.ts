import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/defects/[id]/resolve
 * Mark a defect as resolved with resolution notes.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_UPDATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { resolutionNotes } = body;

    if (!resolutionNotes || typeof resolutionNotes !== 'string' || resolutionNotes.trim().length === 0) {
      return NextResponse.json(
        { error: 'Resolution notes are required' },
        { status: 400 },
      );
    }

    const db = getDb();

    // Verify defect exists and vehicle belongs to this tenant
    const [defect] = await db
      .select({
        id: vehicleDefects.id,
        vehicleId: vehicleDefects.vehicleId,
        resolvedAt: vehicleDefects.resolvedAt,
      })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(and(eq(vehicleDefects.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!defect) {
      return NextResponse.json({ error: 'Defect not found' }, { status: 404 });
    }

    if (defect.resolvedAt) {
      return NextResponse.json({ error: 'Defect is already resolved' }, { status: 409 });
    }

    await db
      .update(vehicleDefects)
      .set({
        resolvedAt: new Date(),
        resolvedByUserId: session.user.id,
        resolutionNotes: resolutionNotes.trim(),
        updatedAt: new Date(),
      })
      .where(eq(vehicleDefects.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[defects/resolve] POST failed:', error);
    return NextResponse.json({ error: 'Failed to resolve defect' }, { status: 500 });
  }
}
