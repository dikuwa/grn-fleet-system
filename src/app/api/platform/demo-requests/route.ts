import { NextRequest, NextResponse } from 'next/server';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { demoRequests, demoSandboxes, demoRequestStatusEnum } from '@/db/schema/demo-requests';

const DEMO_STATUSES = demoRequestStatusEnum.enumValues;
type DemoStatus = (typeof DEMO_STATUSES)[number];

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const status = searchParams.get('status') || '';
    const q = searchParams.get('q')?.trim() || '';
    const page = Math.max(1, Number.parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(searchParams.get('limit') || '25', 10) || 25));
    const offset = (page - 1) * limit;
    const db = getDb();

    if (id) {
      const [demo] = await db.select().from(demoRequests).where(eq(demoRequests.id, id)).limit(1);
      if (!demo) return NextResponse.json({ error: 'Demo request not found' }, { status: 404 });
      const [sandbox] = await db.select().from(demoSandboxes).where(eq(demoSandboxes.demoRequestId, id)).limit(1);
      return NextResponse.json({ success: true, data: { request: demo, sandbox: sandbox ?? null } });
    }

    const conditions: SQL[] = [];
    if (status && DEMO_STATUSES.includes(status as DemoStatus)) conditions.push(eq(demoRequests.status, status as DemoStatus));
    if (q) {
      conditions.push(
        or(
          ilike(demoRequests.name, `%${q}%`),
          ilike(demoRequests.email, `%${q}%`),
          ilike(demoRequests.company, `%${q}%`),
          ilike(demoRequests.jobTitle, `%${q}%`),
        )!,
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [requests, totalRows, statsRows, sandboxes] = await Promise.all([
      db.select().from(demoRequests).where(where).orderBy(desc(demoRequests.createdAt)).limit(limit).offset(offset),
      db.select({ count: count() }).from(demoRequests).where(where),
      db.select({
        total: count(),
        new: sql<number>`count(*) filter (where ${demoRequests.status} = 'new')`,
        qualified: sql<number>`count(*) filter (where ${demoRequests.status} = 'qualified')`,
        scheduled: sql<number>`count(*) filter (where ${demoRequests.status} = 'scheduled')`,
        completed: sql<number>`count(*) filter (where ${demoRequests.status} = 'completed')`,
        converted: sql<number>`count(*) filter (where ${demoRequests.status} = 'converted')`,
      }).from(demoRequests),
      db.select({ id: demoSandboxes.id, demoRequestId: demoSandboxes.demoRequestId, tenantId: demoSandboxes.tenantId, status: demoSandboxes.status, expiresAt: demoSandboxes.expiresAt, adminEmail: demoSandboxes.adminEmail }).from(demoSandboxes),
    ]);

    const sandboxByRequest = new Map(sandboxes.map((sandbox) => [sandbox.demoRequestId, sandbox]));
    const total = Number(totalRows[0]?.count ?? 0);
    const stats = statsRows[0];

    return NextResponse.json({
      success: true,
      data: {
        requests: requests.map((demo) => ({ ...demo, sandbox: sandboxByRequest.get(demo.id) ?? null })),
        stats: {
          total: Number(stats?.total ?? 0),
          new: Number(stats?.new ?? 0),
          qualified: Number(stats?.qualified ?? 0),
          scheduled: Number(stats?.scheduled ?? 0),
          completed: Number(stats?.completed ?? 0),
          converted: Number(stats?.converted ?? 0),
        },
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    });
  } catch (error) {
    console.error('[Platform Demo Requests] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load demo requests' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.DEMO_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json().catch(() => null);
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!id) return NextResponse.json({ error: 'Demo request ID is required' }, { status: 400 });

    const db = getDb();
    const [existing] = await db.select().from(demoRequests).where(eq(demoRequests.id, id)).limit(1);
    if (!existing) return NextResponse.json({ error: 'Demo request not found' }, { status: 404 });

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.status !== undefined) {
      if (!DEMO_STATUSES.includes(body.status as DemoStatus)) return NextResponse.json({ error: 'Invalid demo status' }, { status: 400 });
      updates.status = body.status;
      if (body.status === 'qualified') {
        updates.qualifiedByUserId = session.user.id;
        updates.qualifiedAt = existing.qualifiedAt ?? new Date();
      }
    }
    if (body.scheduledDemoAt !== undefined) updates.scheduledDemoAt = body.scheduledDemoAt ? new Date(body.scheduledDemoAt) : null;
    if (body.scheduledDemoLink !== undefined) updates.scheduledDemoLink = body.scheduledDemoLink?.trim() || null;
    if (body.contactNotes !== undefined || body.notes !== undefined) updates.contactNotes = String(body.contactNotes ?? body.notes ?? '').trim() || null;
    if (body.lastContactAt !== undefined) updates.lastContactAt = body.lastContactAt ? new Date(body.lastContactAt) : null;
    if (body.nextContactAt !== undefined) updates.nextContactAt = body.nextContactAt ? new Date(body.nextContactAt) : null;

    const [updated] = await db.update(demoRequests).set(updates).where(eq(demoRequests.id, id)).returning();
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Demo Requests] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update demo request' }, { status: 500 });
  }
}
