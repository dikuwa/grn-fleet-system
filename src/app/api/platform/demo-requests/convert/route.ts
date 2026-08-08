import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { demoRequests, demoSandboxes } from '@/db/schema/demo-requests';
import { tenants } from '@/db/schema/tenants';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const demoPermission = await requirePermission(session, Permissions.DEMO_MANAGE);
    if (demoPermission instanceof NextResponse) return demoPermission;

    const body = await request.json().catch(() => null);
    const demoRequestId = typeof body?.demoRequestId === 'string' ? body.demoRequestId : '';
    const tenantId = typeof body?.tenantId === 'string' ? body.tenantId : '';
    if (!demoRequestId || !tenantId) {
      return NextResponse.json({ error: 'Demo request and tenant are required' }, { status: 400 });
    }

    const db = getDb();
    const [[demo], [tenant], [sandbox]] = await Promise.all([
      db.select().from(demoRequests).where(eq(demoRequests.id, demoRequestId)).limit(1),
      db.select({ id: tenants.id, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId)).limit(1),
      db.select().from(demoSandboxes).where(eq(demoSandboxes.demoRequestId, demoRequestId)).limit(1),
    ]);
    if (!demo) return NextResponse.json({ error: 'Demo request not found' }, { status: 404 });
    if (!tenant) return NextResponse.json({ error: 'Onboarded tenant not found' }, { status: 404 });

    const now = new Date();
    await db.update(demoRequests).set({
      status: 'converted',
      updatedAt: now,
      lastContactAt: now,
      contactNotes: [demo.contactNotes, `Converted to tenant ${tenant.name} (${tenant.id}).`].filter(Boolean).join('\n'),
      metadata: { ...(demo.metadata ?? {}), convertedTenantId: tenant.id, convertedAt: now.toISOString() },
    }).where(eq(demoRequests.id, demoRequestId));

    if (sandbox) {
      await db.update(demoSandboxes).set({
        status: 'converted',
        isActive: false,
        convertedToPaidTenantId: tenant.id,
        conversionNotes: `Converted to tenant ${tenant.name}`,
      }).where(eq(demoSandboxes.id, sandbox.id));
      await db.update(tenants).set({
        status: 'SUSPENDED',
        lifecycleStatus: 'SUSPENDED',
        lifecycleReason: `Demo converted to production tenant ${tenant.id}`,
        lifecycleChangedAt: now,
        updatedAt: now,
      }).where(eq(tenants.id, sandbox.tenantId));
    }

    return NextResponse.json({ success: true, data: { demoRequestId, tenantId, converted: true } });
  } catch (error) {
    console.error('[Platform Demo Conversion] POST failed:', error);
    return NextResponse.json({ error: 'Failed to complete demo conversion' }, { status: 500 });
  }
}
