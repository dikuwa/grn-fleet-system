import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import {
  parseRequestRoutingCorrection,
  requestRoutingChanged,
} from '@/lib/request-routing-correction';

const EDITABLE_STATUSES = ['returned', 'rejected', 'supervisor_rejected'] as const;

function canCorrectRequest(
  request: { requesterUserId: string | null; enteredByUserId: string | null },
  userId: string,
) {
  return request.requesterUserId === userId || request.enteredByUserId === userId;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const routeCheck = await requireDashboardAction(session, '/dashboard/requests', 'update');
  if (routeCheck instanceof NextResponse) return routeCheck;
  const permissionCheck = await requirePermission(session, Permissions.REQUEST_CREATE);
  if (permissionCheck instanceof NextResponse) return permissionCheck;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const db = getDb();
  const [existing] = await db
    .select({
      id: transportRequests.id,
      reference: transportRequests.reference,
      status: transportRequests.status,
      requesterUserId: transportRequests.requesterUserId,
      enteredByUserId: transportRequests.enteredByUserId,
      requesterType: transportRequests.requesterType,
      requestOrigin: transportRequests.requestOrigin,
      programmeId: transportRequests.programmeId,
      financialImpact: transportRequests.financialImpact,
      tripCategory: transportRequests.tripCategory,
      estimatedCost: transportRequests.estimatedCost,
      currency: transportRequests.currency,
      costCentre: transportRequests.costCentre,
      fundingSource: transportRequests.fundingSource,
      budgetReference: transportRequests.budgetReference,
      version: transportRequests.version,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
    .limit(1);

  if (!existing || !canCorrectRequest(existing, session.user.id)) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  if (!EDITABLE_STATUSES.includes(existing.status as (typeof EDITABLE_STATUSES)[number])) {
    return NextResponse.json(
      { error: `Request routing cannot be corrected from status ${existing.status}` },
      { status: 409 },
    );
  }

  const parsed = parseRequestRoutingCorrection(body, existing);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 422 });
  }

  if (!requestRoutingChanged(existing, parsed.fields)) {
    return NextResponse.json({ success: true, changed: false, version: existing.version });
  }

  const [updated] = await db
    .update(transportRequests)
    .set({
      requestOrigin: parsed.fields.requestOrigin,
      financialImpact: parsed.fields.financialImpact,
      tripCategory: parsed.fields.tripCategory,
      estimatedCost: parsed.fields.estimatedCost,
      currency: parsed.fields.currency,
      costCentre: parsed.fields.costCentre,
      fundingSource: parsed.fields.fundingSource,
      budgetReference: parsed.fields.budgetReference,
      version: existing.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(transportRequests.id, id),
        eq(transportRequests.tenantId, session.tenantId),
        eq(transportRequests.status, existing.status),
        eq(transportRequests.version, existing.version),
      ),
    )
    .returning({ version: transportRequests.version });

  if (!updated) {
    return NextResponse.json(
      { error: 'This request changed while you were reviewing its budget details. Refresh and try again.' },
      { status: 409 },
    );
  }

  try {
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'request.routing_corrected',
      entityType: 'transport_request',
      entityId: id,
      sourceChannel: 'dashboard',
      before: {
        financialImpact: existing.financialImpact,
        tripCategory: existing.tripCategory,
        estimatedCost: existing.estimatedCost,
        currency: existing.currency,
        costCentre: existing.costCentre,
        fundingSource: existing.fundingSource,
        budgetReference: existing.budgetReference,
      },
      after: parsed.fields,
      summary: `${existing.reference} routing and budget details corrected before resubmission`,
    });
  } catch (auditError) {
    console.warn('[request/routing-correction] Post-commit audit write failed:', auditError);
  }

  return NextResponse.json({ success: true, changed: true, version: updated.version });
}
