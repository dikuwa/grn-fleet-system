import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { demoRequests, demoSandboxes } from '@/db/schema/demo-requests';
import { tenants } from '@/db/schema/tenants';
import { desc, eq } from 'drizzle-orm';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { publishLiveDemoSandbox } from '@/lib/public-demo';
import { recordAuditEvent } from '@/lib/audit-event';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requirePermission(auth.session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const rows = await db
      .select({
        id: demoSandboxes.id,
        tenantId: demoSandboxes.tenantId,
        tenantName: tenants.name,
        company: demoRequests.company,
        status: demoSandboxes.status,
        isActive: demoSandboxes.isActive,
        expiresAt: demoSandboxes.expiresAt,
        lastAccessedAt: demoSandboxes.lastAccessedAt,
        demoViews: demoSandboxes.demoViews,
        metadata: demoSandboxes.metadata,
        createdAt: demoSandboxes.createdAt,
      })
      .from(demoSandboxes)
      .innerJoin(tenants, eq(tenants.id, demoSandboxes.tenantId))
      .innerJoin(demoRequests, eq(demoRequests.id, demoSandboxes.demoRequestId))
      .orderBy(desc(demoSandboxes.createdAt));

    return NextResponse.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        isPublicLiveDemo:
          Boolean((row.metadata as Record<string, unknown> | null)?.publicLiveDemo) &&
          row.isActive &&
          row.status === 'active' &&
          row.expiresAt > new Date(),
      })),
    });
  } catch (error) {
    console.error('[Platform Live Demo] load failed:', error);
    return NextResponse.json({ error: 'Live demo sandboxes could not be loaded' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requirePermission(auth.session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json().catch(() => null);
    const sandboxId = typeof body?.sandboxId === 'string' ? body.sandboxId : '';
    const enabled = body?.enabled === true;
    if (!sandboxId) {
      return NextResponse.json({ error: 'Sandbox ID is required' }, { status: 400 });
    }

    const db = getDb();
    const [sandbox] = await db
      .select({ tenantId: demoSandboxes.tenantId })
      .from(demoSandboxes)
      .where(eq(demoSandboxes.id, sandboxId))
      .limit(1);
    if (!sandbox) return NextResponse.json({ error: 'Sandbox not found' }, { status: 404 });

    const updated = await publishLiveDemoSandbox(sandboxId, enabled);
    await recordAuditEvent({
      tenantId: sandbox.tenantId,
      actorUserId: auth.session.user.id,
      eventType: enabled ? 'live_demo_published' : 'live_demo_unpublished',
      action: 'UPDATE',
      entityType: 'demo_sandbox',
      entityId: sandboxId,
      summary: enabled
        ? 'Sandbox published as the public live demo.'
        : 'Sandbox removed from the public live demo.',
    }).catch(() => {});

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Live Demo] publish failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Live demo update failed' },
      { status: 400 },
    );
  }
}
