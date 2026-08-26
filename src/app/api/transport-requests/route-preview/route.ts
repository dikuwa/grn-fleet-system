import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees, programmes, workflowDefinitions, workflowSteps } from '@/db/schema';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { parseRequestRoutingInput } from '@/lib/request-routing-input';
import { resolveWorkflowRoute } from '@/lib/workflow-route-resolver';
import { normalizeAssignmentConfig } from '@/lib/workflow-builder';

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.REQUEST_CREATE);
  if (permission instanceof NextResponse) return permission;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const scope = body.scope === 'national' ? 'national' : 'regional';
  const db = getDb();

  const programmeId = typeof body.programmeId === 'string' ? body.programmeId.trim() : '';
  let hasProgramme = false;
  if (programmeId) {
    const [linkedProgramme] = await db
      .select({ id: programmes.id })
      .from(programmes)
      .where(
        and(
          eq(programmes.id, programmeId),
          eq(programmes.tenantId, session.tenantId),
          sql`${programmes.status} IN ('approved', 'published')`,
          sql`${programmes.archivedAt} IS NULL`,
          sql`(${programmes.endDate} IS NULL OR ${programmes.endDate} >= now())`,
        ),
      )
      .limit(1);
    if (!linkedProgramme) {
      return NextResponse.json(
        {
          error:
            'The selected programme is not available. Only approved or published, current, non-archived programmes can be linked to transport requests.',
        },
        { status: 400 },
      );
    }
    hasProgramme = true;
  }

  const routingInput = parseRequestRoutingInput(body, {
    requesterType: body.requesterType ?? 'internal',
    hasProgramme,
  });
  if (!routingInput.ok) {
    return NextResponse.json({ error: routingInput.error }, { status: 422 });
  }

  const requestedEmployeeId =
    typeof body.requesterEmployeeId === 'string' ? body.requesterEmployeeId.trim() : '';
  if (requestedEmployeeId) {
    const assistedPermission = await requirePermission(session, Permissions.SECURE_REQUEST_ASSIST);
    if (assistedPermission instanceof NextResponse) return assistedPermission;
  }
  const [requester] = await db
    .select({
      id: employees.id,
      regionId: employees.regionId,
      officeId: employees.officeId,
      departmentId: employees.departmentId,
    })
    .from(employees)
    .where(
      and(
        eq(employees.tenantId, session.tenantId),
        requestedEmployeeId
          ? eq(employees.id, requestedEmployeeId)
          : eq(employees.userId, session.user.id),
        eq(employees.employmentStatus, 'active'),
      ),
    )
    .limit(1);
  if (!requester) {
    return NextResponse.json(
      { error: 'Your account is not linked to an active staff record.' },
      { status: 409 },
    );
  }

  const candidates = await db
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.tenantId, session.tenantId),
        eq(workflowDefinitions.tripScope, scope),
        eq(workflowDefinitions.isActive, true),
      ),
    );
  const context = {
    tripScope: scope,
    regionId: requester.regionId,
    officeId: requester.officeId,
    departmentId: requester.departmentId,
    requestOrigin: routingInput.fields.requestOrigin,
    financialImpact: routingInput.fields.financialImpact,
    tripCategory: routingInput.fields.tripCategory,
  };
  const resolution = resolveWorkflowRoute(candidates, context);
  if (resolution.status === 'no_match') {
    return NextResponse.json(
      { error: 'No active approval route matches these request conditions.', context },
      { status: 409 },
    );
  }
  if (resolution.status === 'ambiguous') {
    return NextResponse.json(
      {
        error: 'Multiple equally specific approval routes match these request conditions.',
        context,
      },
      { status: 409 },
    );
  }

  const steps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.definitionId, resolution.definition.id))
    .orderBy(workflowSteps.stepOrder);

  return NextResponse.json({
    success: true,
    data: {
      context,
      definition: {
        id: resolution.definition.id,
        name: resolution.definition.name,
        version: resolution.definition.version,
        specificity: resolution.specificity,
      },
      steps: steps.map((step) => {
        const assignment = normalizeAssignmentConfig(step.config, step.assignedUserId);
        return {
          stepOrder: step.stepOrder,
          actionType: step.actionType,
          label: step.label,
          description: step.description,
          requiredPermission: step.requiredPermission,
          assignmentStrategy: assignment.assignmentStrategy,
          assignedUserId: step.actionType === 'acknowledge' ? null : step.assignedUserId,
          operationalLifecycle: ['transport_review', 'authorise', 'acknowledge'].includes(
            step.actionType,
          ),
        };
      }),
      currency: 'NAD',
      currencyDisplay: 'N$',
    },
  });
}
