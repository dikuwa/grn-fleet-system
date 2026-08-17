import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { transportRequests } from '@/db/schema/requests';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { WorkflowEngine } from '@/lib/workflow-engine';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;

    const example = req.nextUrl.searchParams.get('request')?.trim() ?? '';
    if (!example) {
      return NextResponse.json(
        { error: 'Choose an existing submitted request by ID or reference to preview routing.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [request] = await db
      .select({
        id: transportRequests.id,
        reference: transportRequests.reference,
        scope: transportRequests.scope,
        status: transportRequests.status,
        requesterType: transportRequests.requesterType,
        requesterEmployeeId: transportRequests.requesterEmployeeId,
        departmentId: transportRequests.departmentId,
        officeId: transportRequests.officeId,
        regionId: transportRequests.regionId,
        workflowInstanceId: transportRequests.workflowInstanceId,
      })
      .from(transportRequests)
      .where(
        and(
          eq(transportRequests.tenantId, session.tenantId),
          or(eq(transportRequests.id, example), eq(transportRequests.reference, example)),
        ),
      )
      .limit(1);

    if (!request) return NextResponse.json({ error: 'Example request not found.' }, { status: 404 });
    if (!request.workflowInstanceId) {
      return NextResponse.json(
        {
          error:
            'This example request does not have a workflow instance yet. Choose a submitted request so the preview uses the exact runtime resolver.',
        },
        { status: 409 },
      );
    }

    const engine = new WorkflowEngine({ db });
    const runtime = await engine.getWorkflowStatus(request.workflowInstanceId);
    if (!runtime) return NextResponse.json({ error: 'Workflow instance not found.' }, { status: 404 });

    const assignedUserIds = Array.from(
      new Set(
        runtime.definition.steps
          .map((step) => step.assignedUserId)
          .filter((value): value is string => Boolean(value)),
      ),
    );
    const people = assignedUserIds.length
      ? await db
          .select({
            userId: employees.userId,
            employeeId: employees.id,
            firstName: employees.firstName,
            lastName: employees.lastName,
            email: employees.email,
            jobTitle: employees.jobTitle,
            departmentId: employees.departmentId,
            officeId: employees.officeId,
            availabilityStatus: employees.availabilityStatus,
          })
          .from(employees)
          .where(
            and(
              eq(employees.tenantId, session.tenantId),
              inArray(employees.userId, assignedUserIds),
            ),
          )
      : [];
    const personByUserId = new Map(
      people.filter((person) => person.userId).map((person) => [person.userId!, person]),
    );

    const steps = runtime.definition.steps.map((step) => {
      const person = step.assignedUserId ? personByUserId.get(step.assignedUserId) : undefined;
      const config = (step.config ?? {}) as Record<string, unknown>;
      const strategy = String(config.resolvedStrategy ?? config.assignmentStrategy ?? 'permission_pool');
      return {
        stepOrder: step.stepOrder,
        label: step.label,
        actionType: step.actionType,
        requiredPermission: step.requiredPermission,
        assignmentStrategy: config.assignmentStrategy ?? null,
        resolvedStrategy: config.resolvedStrategy ?? null,
        fallbackStrategies: Array.isArray(config.fallbackStrategies) ? config.fallbackStrategies : [],
        assignedUserId: step.assignedUserId,
        resolvedEmployeeId: config.resolvedEmployeeId ?? person?.employeeId ?? null,
        resolvedRoleId: config.resolvedRoleId ?? null,
        resolvedCapacity: config.resolvedCapacity ?? null,
        isActing: config.isActing === true,
        delegationId: config.delegationId ?? null,
        assignee: person
          ? {
              name: `${person.firstName} ${person.lastName}`.trim(),
              email: person.email,
              jobTitle: person.jobTitle,
              availabilityStatus: person.availabilityStatus,
            }
          : null,
        warning:
          step.actionType === 'acknowledge'
            ? 'Driver acknowledgement resolves from the final confirmed allocation, not from a named approval assignee.'
            : !step.assignedUserId && strategy !== 'permission_pool'
              ? `No eligible person resolved through ${strategy.replaceAll('_', ' ')} or its configured fallbacks.`
              : !step.assignedUserId
                ? 'This step is routed to the eligible permission pool rather than one named person.'
                : null,
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        request,
        workflow: {
          instanceId: runtime.instance.id,
          definitionId: runtime.instance.definitionId,
          definitionVersion: runtime.instance.definitionVersion,
          status: runtime.instance.status,
          currentStepOrder: runtime.instance.currentStepOrder,
          isComplete: runtime.isComplete,
        },
        steps,
        warnings: steps.filter((step) => step.warning).map((step) => step.warning),
        resolver: 'runtime',
      },
    });
  } catch (error) {
    console.error('[Workflow Preview] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to preview workflow routing.' },
      { status: 500 },
    );
  }
}
