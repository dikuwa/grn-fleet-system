import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

/**
 * Return a tenant from Platform Review to Tenant Admin setup.
 *
 * This is deliberately separate from the generic lifecycle PATCH because
 * "needs changes" is a normal review outcome, not an onboarding failure.
 * The action is reversible: the Tenant Administrator can resolve the items
 * and submit Operational Setup for review again.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const permission = await requirePermission(auth.session, Permissions.PLATFORM_ADMIN);
    if (permission instanceof NextResponse) return permission;

    const body = (await request.json().catch(() => ({}))) as { reason?: string };
    const reason = typeof body.reason === 'string' && body.reason.trim()
      ? body.reason.trim().slice(0, 500)
      : 'Returned for required setup changes';

    const db = getDb();
    const [tenant] = await db
      .select({ id: tenants.id, name: tenants.name, lifecycleStatus: tenants.lifecycleStatus })
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    if (tenant.lifecycleStatus === 'SETUP_IN_PROGRESS') {
      return NextResponse.json({
        success: true,
        data: { lifecycleStatus: tenant.lifecycleStatus, alreadyReturned: true },
      });
    }

    if (tenant.lifecycleStatus !== 'PENDING_PLATFORM_REVIEW') {
      return NextResponse.json(
        { error: `Only a tenant pending platform review can be returned for changes. Current lifecycle: ${tenant.lifecycleStatus}.` },
        { status: 409 },
      );
    }

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(tenants)
        .set({
          lifecycleStatus: 'SETUP_IN_PROGRESS',
          lifecycleReason: reason,
          lifecycleChangedAt: now,
          updatedAt: now,
        })
        .where(eq(tenants.id, id));

      await recordAuditEvent({
        tenantId: tenant.id,
        actorUserId: auth.session.user.id,
        eventType: 'tenant_setup_returned_for_changes',
        action: 'return_for_changes',
        entityType: 'tenant',
        entityId: tenant.id,
        before: { lifecycleStatus: tenant.lifecycleStatus },
        after: { lifecycleStatus: 'SETUP_IN_PROGRESS', reason },
        summary: `Platform review returned ${tenant.name} to setup for changes`,
      }, tx);
    });

    return NextResponse.json({
      success: true,
      data: { lifecycleStatus: 'SETUP_IN_PROGRESS', reason },
    });
  } catch (error) {
    console.error('[Platform Tenant Review] Return for changes failed:', error);
    return NextResponse.json({ error: 'Could not return tenant setup for changes' }, { status: 500 });
  }
}
