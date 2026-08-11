import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  workflowDefinitions,
  workflowSteps,
  tenantMemberships,
  roleAssignments,
  rolePermissions,
  user,
  offices,
  departments,
  regions,
} from '@/db/schema';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { runAtomicMutations } from '@/lib/db-atomic';
import { validateWorkflowRouting } from '@/lib/workflow-routing';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const db = getDb();
  const definitions = await db
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.tenantId, session.tenantId),
        eq(workflowDefinitions.isActive, true),
      ),
    )
    .orderBy(workflowDefinitions.tripScope, workflowDefinitions.version);
  const definitionIds = definitions.map((definition) => definition.id);
  const steps = definitionIds.length
    ? await db
        .select()
        .from(workflowSteps)
        .where(inArray(workflowSteps.definitionId, definitionIds))
        .orderBy(workflowSteps.stepOrder)
    : [];

  const [members, roleRows, officeRows, departmentRows, regionRows] = await Promise.all([
    db
      .select({ userId: tenantMemberships.userId, name: user.name, email: user.email })
      .from(tenantMemberships)
      .innerJoin(user, eq(tenantMemberships.userId, user.id))
      .where(
        and(
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(tenantMemberships.status, 'active'),
        ),
      ),
    db
      .select({
        userId: user.id,
        name: user.name,
        email: user.email,
        permissionCode: rolePermissions.permissionCode,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
      })
      .from(tenantMemberships)
      .innerJoin(user, eq(tenantMemberships.userId, user.id))
      .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
      .where(
        and(
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(tenantMemberships.status, 'active'),
        ),
      ),
    db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(and(eq(offices.tenantId, session.tenantId), eq(offices.isActive, true))),
    db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.tenantId, session.tenantId), eq(departments.isActive, true))),
    db
      .select({ id: regions.id, name: regions.name })
      .from(regions)
      .where(and(eq(regions.tenantId, session.tenantId), eq(regions.isActive, true))),
  ]);

  const now = new Date();
  const eligibleByPermission: Record<
    string,
    Array<{ userId: string; name: string | null; email: string }>
  > = {};
  for (const row of roleRows) {
    if (new Date(row.startDate) > now) continue;
    if (row.endDate && new Date(row.endDate) <= now) continue;
    (eligibleByPermission[row.permissionCode] ??= []).push({
      userId: row.userId,
      name: row.name,
      email: row.email,
    });
  }
  for (const code of Object.keys(eligibleByPermission)) {
    const seen = new Set<string>();
    eligibleByPermission[code] = eligibleByPermission[code].filter((person) => {
      if (seen.has(person.userId)) return false;
      seen.add(person.userId);
      return true;
    });
  }

  return NextResponse.json({
    success: true,
    data: {
      definitions: definitions.map((definition) => ({
        ...definition,
        steps: steps.filter((step) => step.definitionId === definition.id),
      })),
      users: members,
      eligibleByPermission,
      offices: officeRows,
      departments: departmentRows,
      regions: regionRows,
    },
  });
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const body = await request.json();
  if (!body.definitionId || !Array.isArray(body.steps)) {
    return NextResponse.json(
      { error: 'Definition and step assignments are required' },
      { status: 400 },
    );
  }

  const db = getDb();
  const [definition] = await db
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.id, body.definitionId),
        eq(workflowDefinitions.tenantId, session.tenantId),
      ),
    )
    .limit(1);
  if (!definition)
    return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 });
  if (!definition.isActive) {
    return NextResponse.json(
      { error: 'This workflow version is no longer active. Refresh before making changes.' },
      { status: 409 },
    );
  }

  const criteria = [
    {
      value: body.regionId,
      table: regions,
      id: regions.id,
      tenantId: regions.tenantId,
      isActive: regions.isActive,
      label: 'Region',
    },
    {
      value: body.officeId,
      table: offices,
      id: offices.id,
      tenantId: offices.tenantId,
      isActive: offices.isActive,
      label: 'Office',
    },
    {
      value: body.departmentId,
      table: departments,
      id: departments.id,
      tenantId: departments.tenantId,
      isActive: departments.isActive,
      label: 'Department',
    },
  ] as const;
  for (const criterion of criteria) {
    if (!criterion.value) continue;
    const [owned] = await db
      .select({ id: criterion.id })
      .from(criterion.table)
      .where(
        and(
          eq(criterion.id, criterion.value),
          eq(criterion.tenantId, session.tenantId),
          eq(criterion.isActive, true),
        ),
      )
      .limit(1);
    if (!owned) {
      return NextResponse.json(
        { error: `${criterion.label} must be active and belong to this tenant` },
        { status: 422 },
      );
    }
  }

  const definitionSteps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.definitionId, definition.id))
    .orderBy(asc(workflowSteps.stepOrder));
  const routingValidation = validateWorkflowRouting(definitionSteps, body.steps);
  if (!routingValidation.ok) {
    return NextResponse.json({ error: routingValidation.error }, { status: 422 });
  }
  const submittedSteps = routingValidation.steps;

  const assignedUserIds = submittedSteps
    .map((step) =>
      typeof step.assignedUserId === 'string' && step.assignedUserId ? step.assignedUserId : null,
    )
    .filter((value): value is string => Boolean(value));
  const uniqueAssignedUserIds = [...new Set(assignedUserIds)];

  if (uniqueAssignedUserIds.length) {
    const members = await db
      .select({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, session.tenantId),
          inArray(tenantMemberships.userId, uniqueAssignedUserIds),
          eq(tenantMemberships.status, 'active'),
        ),
      );
    if (new Set(members.map((member) => member.userId)).size !== uniqueAssignedUserIds.length) {
      return NextResponse.json(
        { error: 'Every assigned person must be an active tenant user' },
        { status: 422 },
      );
    }
  }

  const requiredPermissions = [
    ...new Set(
      definitionSteps
        .map((step) => step.requiredPermission)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const permissionGrants =
    uniqueAssignedUserIds.length && requiredPermissions.length
      ? await db
          .select({
            userId: tenantMemberships.userId,
            permissionCode: rolePermissions.permissionCode,
            startDate: roleAssignments.startDate,
            endDate: roleAssignments.endDate,
          })
          .from(tenantMemberships)
          .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
          .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
          .where(
            and(
              eq(tenantMemberships.tenantId, session.tenantId),
              eq(tenantMemberships.status, 'active'),
              inArray(tenantMemberships.userId, uniqueAssignedUserIds),
              inArray(rolePermissions.permissionCode, requiredPermissions),
            ),
          )
      : [];

  const now = new Date();
  const activeGrantKeys = new Set(
    permissionGrants
      .filter((grant) => grant.startDate <= now && (!grant.endDate || grant.endDate > now))
      .map((grant) => `${grant.userId}:${grant.permissionCode}`),
  );
  const stepById = new Map(definitionSteps.map((step) => [step.id, step]));
  for (const submitted of submittedSteps) {
    const assignedUserId =
      typeof submitted.assignedUserId === 'string' && submitted.assignedUserId
        ? submitted.assignedUserId
        : null;
    if (!assignedUserId) continue;
    const step = stepById.get(String(submitted.id));
    if (
      step?.requiredPermission &&
      !activeGrantKeys.has(`${assignedUserId}:${step.requiredPermission}`)
    ) {
      return NextResponse.json(
        {
          error: `${step.label} can only be assigned to an active user who holds ${step.requiredPermission}.`,
        },
        { status: 422 },
      );
    }
  }

  const nextRegionId = body.regionId || null;
  const nextOfficeId = body.officeId || null;
  const nextDepartmentId = body.departmentId || null;
  const submittedById = new Map(submittedSteps.map((step) => [step.id, step]));
  const hasChanges =
    routingValidation.orderChanged ||
    definition.regionId !== nextRegionId ||
    definition.officeId !== nextOfficeId ||
    definition.departmentId !== nextDepartmentId ||
    definitionSteps.some(
      (step) => step.assignedUserId !== submittedById.get(step.id)?.assignedUserId,
    );
  if (!hasChanges) {
    return NextResponse.json({ error: 'No routing changes were submitted.' }, { status: 422 });
  }

  const updatedAt = new Date();
  const nextDefinitionId = crypto.randomUUID();
  const nextVersion = definition.version + 1;
  await runAtomicMutations((executor) => [
    executor
      .update(workflowDefinitions)
      .set({ isActive: false, updatedAt })
      .where(
        and(
          eq(workflowDefinitions.id, definition.id),
          eq(workflowDefinitions.tenantId, session.tenantId),
          eq(workflowDefinitions.isActive, true),
        ),
      ),
    executor.insert(workflowDefinitions).values({
      id: nextDefinitionId,
      tenantId: definition.tenantId,
      tripScope: definition.tripScope,
      regionId: nextRegionId,
      officeId: nextOfficeId,
      departmentId: nextDepartmentId,
      version: nextVersion,
      name: definition.name,
      isActive: true,
      config: definition.config,
      createdAt: updatedAt,
      updatedAt,
    }),
    executor.insert(workflowSteps).values(
      submittedSteps.map((submitted) => {
        const source = definitionSteps.find((step) => step.id === submitted.id)!;
        return {
          id: crypto.randomUUID(),
          definitionId: nextDefinitionId,
          stepOrder: submitted.stepOrder,
          actionType: source.actionType,
          requiredPermission: source.requiredPermission,
          assignedUserId: submitted.assignedUserId,
          label: source.label,
          description: source.description,
          requiresComment: source.requiresComment,
          reminderAfterHours: source.reminderAfterHours,
          escalationAfterHours: source.escalationAfterHours,
          allowsEmergencyOverride: source.allowsEmergencyOverride,
          separationDutyRole: source.separationDutyRole,
          config: source.config,
          createdAt: updatedAt,
        };
      }),
    ),
  ]);

  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    eventType: 'workflow_routing_updated',
    action: 'update',
    entityType: 'workflow_definition',
    entityId: nextDefinitionId,
    summary: `${definition.name} published as version ${nextVersion}`,
    before: {
      definitionId: definition.id,
      version: definition.version,
      regionId: definition.regionId,
      officeId: definition.officeId,
      departmentId: definition.departmentId,
      steps: definitionSteps.map((step) => ({
        id: step.id,
        stepOrder: step.stepOrder,
        label: step.label,
        assignedUserId: step.assignedUserId,
      })),
    },
    after: {
      definitionId: nextDefinitionId,
      version: nextVersion,
      regionId: nextRegionId,
      officeId: nextOfficeId,
      departmentId: nextDepartmentId,
      orderChanged: routingValidation.orderChanged,
      steps: submittedSteps.map((step) => ({
        stepOrder: step.stepOrder,
        label: stepById.get(step.id)?.label,
        assignedUserId: step.assignedUserId,
      })),
    },
  });

  return NextResponse.json({
    success: true,
    data: { definitionId: nextDefinitionId, version: nextVersion },
  });
}
