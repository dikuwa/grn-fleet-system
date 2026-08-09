import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
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

export async function GET(request: NextRequest) {
  try {
    const auth = await requireDraftAccess(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const db = getDb();

    const drafts = await db
      .select({
        id: requestDrafts.id,
        clientDraftId: requestDrafts.clientDraftId,
        requesterEmployeeId: requestDrafts.requesterEmployeeId,
        lastStep: requestDrafts.lastStep,
        payload: requestDrafts.payload,
        createdAt: requestDrafts.createdAt,
        updatedAt: requestDrafts.updatedAt,
      })
      .from(requestDrafts)
      .where(and(eq(requestDrafts.tenantId, session.tenantId), eq(requestDrafts.userId, session.user.id)))
      .orderBy(desc(requestDrafts.updatedAt))
      .limit(20);

    return NextResponse.json({
      success: true,
      data: drafts.map((draft) => ({
        id: draft.id,
        clientDraftId: draft.clientDraftId,
        requesterEmployeeId: draft.requesterEmployeeId,
        lastStep: draft.lastStep,
        purpose: typeof draft.payload?.purpose === 'string' ? draft.payload.purpose : '',
        scope: draft.payload?.scope === 'national' ? 'national' : 'regional',
        createdAt: draft.createdAt,
        updatedAt: draft.updatedAt,
      })),
    });
  } catch (error) {
    console.error('[Request Drafts] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load request drafts' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireDraftAccess(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const body = await request.json() as {
      clientDraftId?: string;
      requesterEmployeeId?: string;
      lastStep?: number;
      data?: unknown;
    };

    const payload = parseDraftPayload(body.data);
    if (!payload) {
      return NextResponse.json({ error: 'Draft data is invalid or too large' }, { status: 400 });
    }

    const clientDraftId = typeof body.clientDraftId === 'string' && body.clientDraftId.trim()
      ? body.clientDraftId.trim().slice(0, 120)
      : null;
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

    const now = new Date();
    if (clientDraftId) {
      const [draft] = await db
        .insert(requestDrafts)
        .values({
          tenantId: session.tenantId,
          userId: session.user.id,
          requesterEmployeeId,
          clientDraftId,
          lastStep,
          payload,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [requestDrafts.tenantId, requestDrafts.userId, requestDrafts.clientDraftId],
          set: { requesterEmployeeId, lastStep, payload, updatedAt: now },
        })
        .returning();
      return NextResponse.json({ success: true, data: draft }, { status: 201 });
    }

    const [draft] = await db
      .insert(requestDrafts)
      .values({
        tenantId: session.tenantId,
        userId: session.user.id,
        requesterEmployeeId,
        lastStep,
        payload,
        updatedAt: now,
      })
      .returning();

    return NextResponse.json({ success: true, data: draft }, { status: 201 });
  } catch (error) {
    console.error('[Request Drafts] POST failed:', error);
    return NextResponse.json({ error: 'Failed to save request draft' }, { status: 500 });
  }
}
