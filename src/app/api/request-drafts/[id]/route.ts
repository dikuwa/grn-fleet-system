import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { requestDrafts, type RequestDraftPayload } from '@/db/schema/request-drafts';
import { employees } from '@/db/schema/people';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const MAX_DRAFT_BYTES = 150_000;
const MAX_STEP = 4;

function parseDraftPayload(value: unknown): RequestDraftPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_DRAFT_BYTES) return null;
  } catch {
    return null;
  }
  return value as RequestDraftPayload;
}

async function requireDraftAccess(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const roleCheck = await requireDashboardAction(auth.session, '/dashboard/requests/new', 'create');
  if (roleCheck instanceof NextResponse) return { ok: false as const, error: roleCheck };
  return auth;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireDraftAccess(request);
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const { session } = auth;
    const db = getDb();

    const [draft] = await db
      .select()
      .from(requestDrafts)
      .where(and(
        eq(requestDrafts.id, id),
        eq(requestDrafts.tenantId, session.tenantId),
        eq(requestDrafts.userId, session.user.id),
      ))
      .limit(1);

    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: draft });
  } catch (error) {
    console.error('[Request Drafts] GET detail failed:', error);
    return NextResponse.json({ error: 'Failed to load request draft' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireDraftAccess(request);
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const { session } = auth;
    const body = await request.json() as {
      requesterEmployeeId?: string | null;
      lastStep?: number;
      data?: unknown;
    };
    const payload = parseDraftPayload(body.data);
    if (!payload) {
      return NextResponse.json({ error: 'Draft data is invalid or too large' }, { status: 400 });
    }

    const lastStep = Number.isInteger(body.lastStep)
      ? Math.min(MAX_STEP, Math.max(0, Number(body.lastStep)))
      : 0;
    const db = getDb();

    let requesterEmployeeId: string | null = null;
    if (body.requesterEmployeeId) {
      const [employee] = await db
        .select({ id: employees.id, userId: employees.userId })
        .from(employees)
        .where(and(
          eq(employees.id, body.requesterEmployeeId),
          eq(employees.tenantId, session.tenantId),
          eq(employees.employmentStatus, 'active'),
        ))
        .limit(1);
      if (!employee) {
        return NextResponse.json({ error: 'Requester employee is inactive or outside your organisation' }, { status: 400 });
      }
      if (employee.userId !== session.user.id) {
        const assistCheck = await requirePermission(session, Permissions.SECURE_REQUEST_ASSIST);
        if (assistCheck instanceof NextResponse) {
          return NextResponse.json({ error: 'You may only save a draft for your own linked employee record' }, { status: 403 });
        }
      }
      requesterEmployeeId = employee.id;
    }

    const [updated] = await db
      .update(requestDrafts)
      .set({ requesterEmployeeId, lastStep, payload, updatedAt: new Date() })
      .where(and(
        eq(requestDrafts.id, id),
        eq(requestDrafts.tenantId, session.tenantId),
        eq(requestDrafts.userId, session.user.id),
      ))
      .returning();

    if (!updated) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Request Drafts] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update request draft' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireDraftAccess(request);
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const { session } = auth;
    const db = getDb();

    const [deleted] = await db
      .delete(requestDrafts)
      .where(and(
        eq(requestDrafts.id, id),
        eq(requestDrafts.tenantId, session.tenantId),
        eq(requestDrafts.userId, session.user.id),
      ))
      .returning({ id: requestDrafts.id });

    if (!deleted) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });
    return NextResponse.json({ success: true, data: deleted });
  } catch (error) {
    console.error('[Request Drafts] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to delete request draft' }, { status: 500 });
  }
}
