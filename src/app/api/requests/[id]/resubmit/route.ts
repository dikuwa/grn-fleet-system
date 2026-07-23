import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { transportRequests, requestRevisions, auditEvents } from '@/db/schema';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { WorkflowEngine } from '@/lib/workflow-engine';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.REQUEST_CREATE);
  if (permission instanceof NextResponse) return permission;
  const body = await request.json().catch(() => ({}));
  if (!body.reason?.trim()) return NextResponse.json({ error: 'Describe the corrections made before resubmitting' }, { status: 400 });
  const db = getDb();
  const [existing] = await db.select().from(transportRequests).where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId))).limit(1);
  if (!existing || existing.requesterUserId !== session.user.id) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  if (!['returned', 'rejected', 'supervisor_rejected'].includes(existing.status)) return NextResponse.json({ error: `Request cannot be resubmitted from status ${existing.status}` }, { status: 409 });
  const nextRevision = existing.revision + 1;
  await db.insert(requestRevisions).values({ requestId: id, revision: nextRevision, reason: body.reason.trim(), createdByUserId: session.user.id, changedFields: body.changedFields || {}, data: { previousStatus: existing.status } });
  await db.update(transportRequests).set({ revision: nextRevision, status: 'submitted', workflowInstanceId: null, submittedAt: new Date(), updatedAt: new Date(), version: existing.version + 1 }).where(eq(transportRequests.id, id));
  const engine = new WorkflowEngine({ db });
  const workflow = await engine.initializeForRequest(id, session.tenantId);
  if (!workflow.ok) return workflow.error;
  await db.insert(auditEvents).values({ tenantId: session.tenantId, tenantSequence: Date.now(), eventType: 'request_resubmitted', actorUserId: session.user.id, action: 'resubmit', entityType: 'transport_request', entityId: id, reason: body.reason.trim(), summary: `Request resubmitted as revision ${nextRevision}`, after: { revision: nextRevision, workflowInstanceId: workflow.instance.id } });
  return NextResponse.json({ success: true, revision: nextRevision, workflowInstanceId: workflow.instance.id });
}
