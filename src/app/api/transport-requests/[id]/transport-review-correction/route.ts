import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { programmes } from '@/db/schema/programmes';
import { requestActivities, transportRequests } from '@/db/schema/requests';
import { vehicleAllocations } from '@/db/schema/trips';
import {
  getSessionPermissions,
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { getApprovalDetail } from '@/lib/approval-detail';
import { recordAuditEvent } from '@/lib/audit-event';
import { runAtomicMutations } from '@/lib/db-atomic';
import { Permissions } from '@/lib/permissions';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

type ActivityInput = {
  title?: string;
  description?: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  estimatedKilometres?: number;
};

type CorrectionBody = {
  purpose?: string;
  specialRequirements?: string | null;
  reason?: string;
  activities?: ActivityInput[];
};

const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed', 'issued'] as const;

function normaliseActivity(activity: {
  title: string;
  description?: string | null;
  venue?: string | null;
  startDate: string | Date;
  endDate: string | Date;
  estimatedKilometres?: number | null;
}) {
  return {
    title: activity.title.trim(),
    description: activity.description?.trim() || '',
    venue: activity.venue?.trim() || '',
    startDate: new Date(activity.startDate).toISOString(),
    endDate: new Date(activity.endDate).toISOString(),
    estimatedKilometres: Number(activity.estimatedKilometres || 0),
  };
}

async function loadContext(id: string, tenantId: string) {
  const db = getDb();
  const [request] = await db
    .select({
      id: transportRequests.id,
      reference: transportRequests.reference,
      status: transportRequests.status,
      version: transportRequests.version,
      purpose: transportRequests.purpose,
      specialRequirements: transportRequests.specialRequirements,
      programmeId: transportRequests.programmeId,
      workflowInstanceId: transportRequests.workflowInstanceId,
      totalAuthorisedKilometres: transportRequests.totalAuthorisedKilometres,
    })
    .from(transportRequests)
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, tenantId)))
    .limit(1);
  if (!request) return null;

  const [activities, liveAllocation] = await Promise.all([
    db
      .select({
        id: requestActivities.id,
        title: requestActivities.title,
        description: requestActivities.description,
        venue: requestActivities.venue,
        startDate: requestActivities.startDate,
        endDate: requestActivities.endDate,
        estimatedKilometres: requestActivities.estimatedKilometres,
      })
      .from(requestActivities)
      .where(eq(requestActivities.requestId, id))
      .orderBy(asc(requestActivities.startDate), asc(requestActivities.id)),
    db
      .select({ id: vehicleAllocations.id, state: vehicleAllocations.state })
      .from(vehicleAllocations)
      .where(
        and(
          eq(vehicleAllocations.requestId, id),
          inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
        ),
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  return { request, activities, liveAllocation };
}

async function requireActiveTransportReviewer(request: NextRequest, id: string) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return { error: auth.error } as const;
  const { session } = auth;

  const routeCheck = await requireDashboardAction(session, '/dashboard/approvals', 'update');
  if (routeCheck instanceof NextResponse) return { error: routeCheck } as const;
  const permissionCheck = await requirePermission(session, Permissions.REQUEST_REVIEW_TRANSPORT);
  if (permissionCheck instanceof NextResponse) return { error: permissionCheck } as const;

  const context = await loadContext(id, session.tenantId);
  if (!context) {
    return { error: NextResponse.json({ error: 'Request not found' }, { status: 404 }) } as const;
  }
  if (context.request.status !== 'transport_review' || !context.request.workflowInstanceId) {
    return {
      error: NextResponse.json(
        { error: 'Request corrections are only available during active Transport Review.' },
        { status: 409 },
      ),
    } as const;
  }

  const permissionCodes = await getSessionPermissions(session);
  const approval = await getApprovalDetail({
    instanceId: context.request.workflowInstanceId,
    tenantId: session.tenantId,
    userId: session.user.id,
    permissionCodes,
  });
  if (!approval?.canAct || approval.currentStep?.actionType !== 'transport_review') {
    return {
      error: NextResponse.json(
        { error: 'You are not the active reviewer for this Transport Review step.' },
        { status: 403 },
      ),
    } as const;
  }

  return { session, context, workflowInstanceId: context.request.workflowInstanceId } as const;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireActiveTransportReviewer(request, id);
  if ('error' in access) return access.error;

  return NextResponse.json({
    success: true,
    data: {
      request: access.context.request,
      activities: access.context.activities,
      hasLiveAllocation: Boolean(access.context.liveAllocation),
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const access = await requireActiveTransportReviewer(request, id);
  if ('error' in access) return access.error;
  const { session, context, workflowInstanceId } = access;

  const body = (await request.json().catch(() => ({}))) as CorrectionBody;
  const reason = body.reason?.trim() || '';
  if (reason.length < 3) {
    return NextResponse.json(
      { error: 'Record a short reason for the Transport Review correction.' },
      { status: 400 },
    );
  }
  if (reason.length > 500) {
    return NextResponse.json(
      { error: 'Correction reason must be 500 characters or fewer.' },
      { status: 422 },
    );
  }

  const purpose = body.purpose !== undefined
    ? body.purpose.trim()
    : context.request.purpose?.trim() || '';
  if (!purpose) return NextResponse.json({ error: 'Purpose is required.' }, { status: 400 });
  if (purpose.length > 2000) {
    return NextResponse.json(
      { error: 'Purpose must be 2,000 characters or fewer.' },
      { status: 422 },
    );
  }

  const specialRequirements = body.specialRequirements === undefined
    ? context.request.specialRequirements
    : body.specialRequirements?.trim() || null;
  if ((specialRequirements?.length || 0) > 2000) {
    return NextResponse.json(
      { error: 'Special requirements must be 2,000 characters or fewer.' },
      { status: 422 },
    );
  }

  const activities = body.activities ?? context.activities.map((activity) => ({
    title: activity.title,
    description: activity.description || undefined,
    venue: activity.venue || undefined,
    startDate: activity.startDate.toISOString(),
    endDate: activity.endDate.toISOString(),
    estimatedKilometres: activity.estimatedKilometres ?? undefined,
  }));
  if (activities.length === 0) {
    return NextResponse.json({ error: 'At least one activity is required.' }, { status: 400 });
  }
  if (
    activities.some((activity) => {
      const start = activity.startDate ? new Date(activity.startDate) : null;
      const end = activity.endDate ? new Date(activity.endDate) : null;
      return (
        !activity.title?.trim() ||
        !start ||
        Number.isNaN(start.getTime()) ||
        !end ||
        Number.isNaN(end.getTime()) ||
        end < start ||
        (activity.estimatedKilometres !== undefined &&
          (!Number.isFinite(Number(activity.estimatedKilometres)) ||
            Number(activity.estimatedKilometres) < 0))
      );
    })
  ) {
    return NextResponse.json(
      { error: 'Each activity needs a title and a valid start/end date range.' },
      { status: 400 },
    );
  }

  const nextActivities = activities.map((activity) => normaliseActivity({
    title: activity.title!,
    description: activity.description,
    venue: activity.venue,
    startDate: activity.startDate!,
    endDate: activity.endDate!,
    estimatedKilometres: activity.estimatedKilometres,
  }));
  const previousActivities = context.activities.map((activity) => normaliseActivity(activity));
  const scheduleChanged = JSON.stringify(nextActivities) !== JSON.stringify(previousActivities);

  if (scheduleChanged && context.liveAllocation) {
    return NextResponse.json(
      {
        error:
          'This request already has a live vehicle/driver allocation. Cancel that allocation first, then save the new schedule and assign resources against the corrected dates.',
        allocationId: context.liveAllocation.id,
      },
      { status: 409 },
    );
  }

  if (context.request.programmeId) {
    const db = getDb();
    const [programme] = await db
      .select({ endDate: programmes.endDate })
      .from(programmes)
      .where(
        and(
          eq(programmes.id, context.request.programmeId),
          eq(programmes.tenantId, session.tenantId),
        ),
      )
      .limit(1);
    if (!programme) {
      return NextResponse.json(
        { error: 'The linked programme is no longer available in this organisation.' },
        { status: 409 },
      );
    }
    if (
      programme.endDate &&
      nextActivities.some((activity) => new Date(activity.endDate) > programme.endDate!)
    ) {
      return NextResponse.json(
        { error: 'An activity cannot end after the linked programme end date.' },
        { status: 400 },
      );
    }
  }

  const totalKm = nextActivities.reduce(
    (sum, activity) => sum + Number(activity.estimatedKilometres || 0),
    0,
  );
  const db = getDb();
  const now = new Date();
  const nowIso = now.toISOString();
  const nextVersion = context.request.version + 1;

  try {
    await runAtomicMutations((tx) => {
      const mutations: any[] = [
        tx.execute(sql`
          WITH request_claim AS (
            UPDATE transport_requests
            SET purpose = ${purpose},
                special_requirements = ${specialRequirements},
                total_authorised_kilometres = ${totalKm || null},
                version = ${nextVersion},
                updated_at = ${nowIso}::timestamptz
            WHERE id = ${id}::uuid
              AND tenant_id = ${session.tenantId}::uuid
              AND status = 'transport_review'
              AND version = ${context.request.version}
              AND workflow_instance_id = ${workflowInstanceId}::uuid
            RETURNING id
          )
          SELECT 1 / (SELECT count(*)::integer FROM request_claim) AS committed
        `),
        tx.delete(requestActivities).where(eq(requestActivities.requestId, id)),
      ];
      mutations.push(
        tx.insert(requestActivities).values(
          nextActivities.map((activity) => ({
            requestId: id,
            title: activity.title,
            description: activity.description || null,
            venue: activity.venue || null,
            startDate: new Date(activity.startDate),
            endDate: new Date(activity.endDate),
            estimatedKilometres: activity.estimatedKilometres || null,
          })),
        ),
      );
      return mutations;
    });
  } catch (error) {
    console.error('[transport-review-correction] Mutation failed:', error);
    return NextResponse.json(
      { error: 'The request changed while corrections were being saved. Refresh and review the latest version.' },
      { status: 409 },
    );
  }

  const [saved] = await db
    .select({ version: transportRequests.version, status: transportRequests.status })
    .from(transportRequests)
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
    .limit(1);
  if (!saved || saved.version !== nextVersion || saved.status !== 'transport_review') {
    return NextResponse.json(
      { error: 'The request changed while corrections were being saved. Refresh and review the latest version.' },
      { status: 409 },
    );
  }

  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    action: 'request.transport_review_corrected',
    entityType: 'transport_request',
    entityId: id,
    sourceChannel: 'dashboard',
    before: {
      purpose: context.request.purpose,
      specialRequirements: context.request.specialRequirements,
      activities: previousActivities,
      version: context.request.version,
    },
    after: {
      purpose,
      specialRequirements,
      activities: nextActivities,
      version: nextVersion,
    },
    reason,
    summary: `${context.request.reference} corrected during Transport Review`,
  }).catch((error) => console.warn('[transport-review-correction] Audit write failed:', error));

  await recordTenantRequestActivity({
    tenantId: session.tenantId,
    requestId: id,
    reference: context.request.reference,
    stage: 'transport_review',
  }).catch((error) => console.warn('[transport-review-correction] Activity write failed:', error));

  return NextResponse.json({
    success: true,
    version: nextVersion,
    scheduleChanged,
  });
}
