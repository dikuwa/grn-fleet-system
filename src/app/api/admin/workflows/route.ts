import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
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
  tenants,
} from '@/db/schema';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { runAtomicMutations } from '@/lib/db-atomic';
import { validateWorkflowRouting } from '@/lib/workflow-routing';
import {
  governedStage,
  normalizeAssignmentConfig,
  validateGovernedActions,
  WORKFLOW_ASSIGNMENT_STRATEGIES,
  WORKFLOW_PRESETS,
  GOVERNED_ACTION_ORDER,
} from '@/lib/workflow-builder';
import {
  FINANCIAL_IMPACTS,
  REQUEST_ORIGINS,
  workflowRoutesAreAmbiguous,
} from '@/lib/workflow-route-resolver';

function optionalCondition(value: unknown, allowed?: readonly string[]): string | null {
  if (value == null || value === '') return null;
  const normalized = String(value).trim().toLowerCase();
  if (allowed && !allowed.includes(normalized)) return '__invalid__';
  if (!allowed && !/^[a-z0-9][a-z0-9_-]{1,49}$/.test(normalized)) return '__invalid__';
  return normalized;
}

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
  const [tenantConfig] = await db
    .select({ metadata: tenants.metadata })
    .from(tenants)
    .where(eq(tenants.id, session.tenantId))
    .limit(1);

  return NextResponse.json({
    success: true,
    data: {
      definitions: definitions.map((definition) => ({
        ...definition,
        steps: steps
          .filter((step) => step.definitionId === definition.id)
          .map((step) => ({
            ...step,
            config: normalizeAssignmentConfig(step.config, step.assignedUserId),
          })),
      })),
      users: members,
      eligibleByPermission,
      offices: officeRows,
      departments: departmentRows,
      regions: regionRows,
      presets: WORKFLOW_PRESETS,
      governedStages: GOVERNED_ACTION_ORDER.map((actionType) => ({ actionType })),
      assignmentStrategies: WORKFLOW_ASSIGNMENT_STRATEGIES,
      workflowRecommendations:
        (tenantConfig?.metadata?.workflowRecommendations as Record<string, unknown> | undefined) ??
        null,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;

  const body = await request.json().catch(() => ({}));
  const tripScope = body.tripScope === 'national' ? 'national' : 'regional';
  const preset = WORKFLOW_PRESETS.find((item) => item.id === body.preset);
  const actionValidation = validateGovernedActions(body.actions ?? preset?.actions);
  if (!preset && !Array.isArray(body.actions)) {
    return NextResponse.json({ error: 'Choose a workflow preset.' }, { status: 422 });
  }
  if (!actionValidation.ok) {
    return NextResponse.json({ error: actionValidation.error }, { status: 422 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length < 3) {
    return NextResponse.json(
      { error: 'Route name must be at least 3 characters.' },
      { status: 422 },
    );
  }
  const regionId = typeof body.regionId === 'string' && body.regionId ? body.regionId : null;
  const officeId = typeof body.officeId === 'string' && body.officeId ? body.officeId : null;
  const departmentId =
    typeof body.departmentId === 'string' && body.departmentId ? body.departmentId : null;
  const requestOrigin = optionalCondition(body.requestOrigin, REQUEST_ORIGINS);
  const financialImpact = optionalCondition(body.financialImpact, FINANCIAL_IMPACTS);
  const tripCategory = optionalCondition(body.tripCategory);
  if ([requestOrigin, financialImpact, tripCategory].includes('__invalid__')) {
    return NextResponse.json(
      { error: 'One or more routing conditions are invalid.' },
      { status: 422 },
    );
  }
  const db = getDb();
  const scopeCriteria = [
    {
      value: regionId,
      table: regions,
      id: regions.id,
      tenantId: regions.tenantId,
      active: regions.isActive,
      label: 'Region',
    },
    {
      value: officeId,
      table: offices,
      id: offices.id,
      tenantId: offices.tenantId,
      active: offices.isActive,
      label: 'Office',
    },
    {
      value: departmentId,
      table: departments,
      id: departments.id,
      tenantId: departments.tenantId,
      active: departments.isActive,
      label: 'Department',
    },
  ] as const;
  for (const criterion of scopeCriteria) {
    if (!criterion.value) continue;
    const [owned] = await db
      .select({ id: criterion.id })
      .from(criterion.table)
      .where(
        and(
          eq(criterion.id, criterion.value),
          eq(criterion.tenantId, session.tenantId),
          eq(criterion.active, true),
        ),
      )
      .limit(1);
    if (!owned)
      return NextResponse.json(
        { error: `${criterion.label} must be active and belong to this tenant.` },
        { status: 422 },
      );
  }
  const existing = await db
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.tenantId, session.tenantId),
        eq(workflowDefinitions.tripScope, tripScope),
        eq(workflowDefinitions.isActive, true),
      ),
    );
  if (
    existing.some(
      (item) =>
        item.regionId === regionId &&
        item.officeId === officeId &&
        item.departmentId === departmentId &&
        item.requestOrigin === requestOrigin &&
        item.financialImpact === financialImpact &&
        item.tripCategory === tripCategory,
    )
  ) {
    return NextResponse.json(
      {
        error: 'An active route already exists for these exact routing conditions.',
      },
      { status: 409 },
    );
  }
  const proposedRoute = {
    id: 'proposed',
    version: 1,
    tripScope,
    regionId,
    officeId,
    departmentId,
    requestOrigin,
    financialImpact,
    tripCategory,
  };
  if (existing.some((item) => workflowRoutesAreAmbiguous(item, proposedRoute))) {
    return NextResponse.json(
      {
        error:
          'This route overlaps another active route at the same precedence. Add a more specific condition or revise the existing route.',
      },
      { status: 409 },
    );
  }
  const definitionId = crypto.randomUUID();
  const now = new Date();
  const stepValues = actionValidation.actions.map((actionType, index) => {
    const stage = governedStage(actionType, tripScope);
    const strategy =
      actionType === 'supervisor_approve'
        ? 'requester_supervisor'
        : actionType === 'organisational_approve' && requestOrigin === 'external'
          ? 'responsible_sponsor'
          : 'permission_pool';
    return {
      id: crypto.randomUUID(),
      definitionId,
      stepOrder: index + 1,
      actionType,
      requiredPermission: stage.requiredPermission,
      assignedUserId: null,
      label: stage.label,
      description: stage.description,
      requiresComment:
        actionType === 'finance_review' ||
        (actionType === 'authorise' && tripScope === 'national'),
      reminderAfterHours: 2,
      escalationAfterHours: 4,
      allowsEmergencyOverride: actionType === 'release' || actionType === 'authorise',
      separationDutyRole: ['supervisor_approve', 'transport_review'].includes(actionType)
        ? 'requester'
        : null,
      config: normalizeAssignmentConfig({ assignmentStrategy: strategy }),
      createdAt: now,
    };
  });
  await runAtomicMutations((executor) => [
    executor.insert(workflowDefinitions).values({
      id: definitionId,
      tenantId: session.tenantId,
      tripScope,
      regionId,
      officeId,
      departmentId,
      requestOrigin,
      financialImpact,
      tripCategory,
      version: 1,
      name,
      isActive: true,
      config: {
        preset: preset?.id ?? 'advanced',
        isFallback:
          !regionId &&
          !officeId &&
          !departmentId &&
          !requestOrigin &&
          !financialImpact &&
          !tripCategory,
      },
      createdAt: now,
      updatedAt: now,
    }),
    executor.insert(workflowSteps).values(stepValues),
  ]);
  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    eventType: 'workflow_route_created',
    action: 'create',
    entityType: 'workflow_definition',
    entityId: definitionId,
    summary: `${name} created from ${preset?.label ?? 'Advanced'} stages`,
    after: {
      tripScope,
      regionId,
      officeId,
      departmentId,
      requestOrigin,
      financialImpact,
      tripCategory,
      actions: actionValidation.actions,
    },
  });
  return NextResponse.json({ success: true, data: { definitionId, version: 1 } }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const body = await request.json().catch(() => ({}));
  const validation = validateGovernedActions(body.actions);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 422 });
  const db = getDb();
  const [definition] = await db
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.id, body.definitionId),
        eq(workflowDefinitions.tenantId, session.tenantId),
        eq(workflowDefinitions.isActive, true),
      ),
    )
    .limit(1);
  if (!definition)
    return NextResponse.json({ error: 'Active workflow definition not found.' }, { status: 404 });
  const existingSteps = await db
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.definitionId, definition.id));
  const nextDefinitionId = crypto.randomUUID();
  const now = new Date();
  await runAtomicMutations((executor) => [
    executor
      .update(workflowDefinitions)
      .set({ isActive: false, updatedAt: now })
      .where(eq(workflowDefinitions.id, definition.id)),
    executor.insert(workflowDefinitions).values({
      ...definition,
      id: nextDefinitionId,
      version: definition.version + 1,
      isActive: true,
      config: { ...(definition.config ?? {}), preset: 'advanced' },
      createdAt: now,
      updatedAt: now,
    }),
    executor.insert(workflowSteps).values(
      validation.actions.map((actionType, index) => {
        const source = existingSteps.find((step) => step.actionType === actionType);
        const stage = governedStage(actionType, definition.tripScope);
        return {
          id: crypto.randomUUID(),
          definitionId: nextDefinitionId,
          stepOrder: index + 1,
          actionType,
          requiredPermission: stage.requiredPermission,
          assignedUserId: actionType === 'acknowledge' ? null : (source?.assignedUserId ?? null),
          label: stage.label,
          description: stage.description,
          requiresComment:
            source?.requiresComment ??
            (actionType === 'finance_review' ||
              (actionType === 'authorise' && definition.tripScope === 'national')),
          reminderAfterHours: source?.reminderAfterHours ?? 2,
          escalationAfterHours: source?.escalationAfterHours ?? 4,
          allowsEmergencyOverride:
            source?.allowsEmergencyOverride ?? ['release', 'authorise'].includes(actionType),
          separationDutyRole:
            source?.separationDutyRole ??
            (['supervisor_approve', 'transport_review'].includes(actionType) ? 'requester' : null),
          config: normalizeAssignmentConfig(
            source?.config ?? {
              assignmentStrategy:
                actionType === 'supervisor_approve'
                  ? 'requester_supervisor'
                  : actionType === 'organisational_approve' &&
                      definition.requestOrigin === 'external'
                    ? 'responsible_sponsor'
                    : 'permission_pool',
            },
            source?.assignedUserId,
          ),
          createdAt: now,
        };
      }),
    ),
  ]);
  await recordAuditEvent({
    tenantId: session.tenantId,
    actorUserId: session.user.id,
    eventType: 'workflow_stages_updated',
    action: 'update',
    entityType: 'workflow_definition',
    entityId: nextDefinitionId,
    summary: `${definition.name} governed stages published as version ${definition.version + 1}`,
    before: { actions: existingSteps.map((step) => step.actionType) },
    after: { actions: validation.actions },
  });
  return NextResponse.json({
    success: true,
    data: { definitionId: nextDefinitionId, version: definition.version + 1 },
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
  const nextRequestOrigin = optionalCondition(body.requestOrigin, REQUEST_ORIGINS);
  const nextFinancialImpact = optionalCondition(body.financialImpact, FINANCIAL_IMPACTS);
  const nextTripCategory = optionalCondition(body.tripCategory);
  if ([nextRequestOrigin, nextFinancialImpact, nextTripCategory].includes('__invalid__')) {
    return NextResponse.json(
      { error: 'One or more routing conditions are invalid.' },
      { status: 422 },
    );
  }
  const competingRoutes = await db
    .select()
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.tenantId, session.tenantId),
        eq(workflowDefinitions.tripScope, definition.tripScope),
        eq(workflowDefinitions.isActive, true),
        ne(workflowDefinitions.id, definition.id),
      ),
    );
  if (
    competingRoutes.some(
      (route) =>
        route.regionId === nextRegionId &&
        route.officeId === nextOfficeId &&
        route.departmentId === nextDepartmentId &&
        route.requestOrigin === nextRequestOrigin &&
        route.financialImpact === nextFinancialImpact &&
        route.tripCategory === nextTripCategory,
    )
  ) {
    return NextResponse.json(
      { error: 'Another active route already covers this exact scope.' },
      { status: 409 },
    );
  }
  const proposedRoute = {
    id: definition.id,
    version: definition.version + 1,
    tripScope: definition.tripScope,
    regionId: nextRegionId,
    officeId: nextOfficeId,
    departmentId: nextDepartmentId,
    requestOrigin: nextRequestOrigin,
    financialImpact: nextFinancialImpact,
    tripCategory: nextTripCategory,
  };
  if (competingRoutes.some((route) => workflowRoutesAreAmbiguous(route, proposedRoute))) {
    return NextResponse.json(
      {
        error:
          'These conditions overlap another active route at the same precedence. Make the route more specific.',
      },
      { status: 409 },
    );
  }
  const submittedById = new Map(submittedSteps.map((step) => [step.id, step]));
  const hasChanges =
    routingValidation.orderChanged ||
    definition.regionId !== nextRegionId ||
    definition.officeId !== nextOfficeId ||
    definition.departmentId !== nextDepartmentId ||
    definition.requestOrigin !== nextRequestOrigin ||
    definition.financialImpact !== nextFinancialImpact ||
    definition.tripCategory !== nextTripCategory ||
    definitionSteps.some(
      (step) =>
        step.assignedUserId !== submittedById.get(step.id)?.assignedUserId ||
        normalizeAssignmentConfig(step.config, step.assignedUserId).assignmentStrategy !==
          (submittedById.get(step.id)?.assignmentStrategy ??
            normalizeAssignmentConfig(step.config, step.assignedUserId).assignmentStrategy),
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
      requestOrigin: nextRequestOrigin,
      financialImpact: nextFinancialImpact,
      tripCategory: nextTripCategory,
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
          config: normalizeAssignmentConfig(
            {
              ...(source.config ?? {}),
              assignmentStrategy:
                submitted.assignmentStrategy ??
                (submitted.assignedUserId ? 'named_user' : 'permission_pool'),
              fallbackStrategies: submitted.fallbackStrategies,
            },
            submitted.assignedUserId,
          ),
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
      requestOrigin: definition.requestOrigin,
      financialImpact: definition.financialImpact,
      tripCategory: definition.tripCategory,
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
