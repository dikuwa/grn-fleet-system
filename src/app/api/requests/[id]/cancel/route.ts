import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

/**
 * PATCH /api/requests/[id]/cancel
 *
 * Cancel a transport request. Only cancellable if status is not already
 * closed, cancelled, or in_progress/vehicle_issued.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.REQUEST_CANCEL);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = body.reason?.trim() || 'Cancelled by user';

    const db = getDb();

    // Fetch the request, ensure it belongs to this tenant
    const [req] = await db
      .select({ id: transportRequests.id, status: transportRequests.status })
      .from(transportRequests)
      .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
      .limit(1);

    if (!req) {
      return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    }

    // Only allow cancellation of non-finalised requests
    const nonCancellableStatuses = ['closed', 'cancelled', 'in_progress', 'vehicle_issued'];
    if (nonCancellableStatuses.includes(req.status)) {
      return NextResponse.json(
        { error: `Cannot cancel a request with status: ${req.status}` },
        { status: 409 },
      );
    }

    await db
      .update(transportRequests)
      .set({
        status: 'cancelled',
        updatedAt: sql`now()`,
      })
      .where(eq(transportRequests.id, id));

    // Audit log
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: 0, // auto-assigned by trigger
      eventType: 'request_cancelled',
      actorUserId: session.user.id,
      action: 'cancel',
      entityType: 'transport_request',
      entityId: id,
      reason: reason,
      sourceChannel: 'web',
    });

    return NextResponse.json({ success: true, status: 'cancelled' });
  } catch (error) {
    console.error('Cancel request failed:', error);
    return NextResponse.json(
      { error: 'Cancel request failed: ' + String(error) },
      { status: 500 },
    );
  }
}
