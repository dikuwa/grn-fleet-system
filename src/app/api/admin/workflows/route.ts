import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
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
  auditEvents,
} from '@/db/schema';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

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
    .where(eq(workflowDefinitions.tenantId, session.tenantId))
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
      .where(and(eq(tenantMemberships.tenantId, session.tenantId), eq(tenantMemberships.status, 'active'))),
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
      .where(and(eq(tenantMemberships.tenantId, session.tenantId), eq(tenantMemberships.status, 'active'))),
    db.select({ id: offices.id, name: offices.name }).from(offices).where(and(eq(offices.tenantId, session.tenantId), eq(offices.isActive, true))),
    db.select({ id: departments.id, name: departments.name }).from(departments).where(and(eq(departments.tenantId, session.tenantId), eq(departments.isActive, true))),
    db.select({ id: regions.id, name: regions.name }).from(regions).where(and(eq(regions.tenantId, session.tenantId), eq(regions.isActive, true))),
  ]);

  const now = new Date();
  const eligibleByPermission: Record<string, Array<{ userId: string; name: string | null; email: string }>> = {};
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
    return NextResponse.json({ error: 'Definition and step assignments are required' }, { status: 400 });
  }

  const db = getDb();
  const [definition] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, body.definitionId), eq(workflowDefinitions.tenantId, session.tenantId)))
    .limit(1);
  if (!definition) return NextResponse.json({ error: 'Workflow definition not found' }, { status: 404 });

  const criteria = [
    { value: body.regionId, table: regions, id: regions.id, tenantId: regions.tenantId, label: 'Region' },
    { value: body.officeId, table: offices, id: offices.id, tenantId: offices.tenantId, label: 'Office' },
    { value: body.departmentId, table: departments, id: departments.id, tenantId: departments.tenantId, label: 'Department' },
  ] as const;
  for (const criterion of criteria) {
    if (!criterion.value) continue;
    const [owned] = await db
      .select({ id: criterion.id })
      .from(criterion.table)
      .where(and(eq(criterion.id, criterion.value), eq(criterion.tenantId, session.tenantId)))
      .limit(1);
    if (!owned) return NextResponse.json({ error: `${criterion.label} is not part of this tenant` }, { status: 422 });
  }

  const submittedSteps = body.steps as Array<{ id?: unknown; assignedUserId?: unknown }>;
  const stepIds = submittedSteps
    .map((step) => (typeof step.id === 'string' ? step.id : ''))
    .filter(Boolean);
  if (stepIds.length !== submittedSteps.length || new Set(stepIds).size !== stepIds.length) {
    return NextResponse.json({ error: 'Every workflow step must be provided once.' }, { status: 422 });
  }

  const definitionSteps = await db
    .select({
      id: workflowSteps.id,
      label: workflowSteps.label,
      requiredPermission: workflowSteps.requiredPermission,
    })
    .from(workflowSteps)
    .where(and(
      eq(workflowSteps.definitionId, definition.id),
      inArray(workflowSteps.id, stepIds),
    ));
  if (definitionSteps.length !== stepIds.length) {
    return NextResponse.json({ error: 'One or more workflow steps do not belong to this definition.' }, { status: 422 });
  }

  const assignedUserIds = submittedSteps
    .map((step) => (typeof step.assignedUserId === 'string' && step.assignedUserId ? step.assignedUserId : null))
    .filter((value): value is string => Boolean(value));
  const uniqueAssignedUserIds = [...new Set(assignedUserIds)];

  if (uniqueAssignedUserIds.length) {
    const members = await db
      .select({ userId: tenantMemberships.userId })
      .from(tenantMemberships)
      .where(and(
        eq(tenantMemberships.tenantId, session.tenantId),
        inArray(tenantMemberships.userId, uniqueAssignedUserIds),
        eq(tenantMemberships.status, 'active'),
      ));
    if (new Set(members.map((member) => member.userId)).size !== uniqueAssignedUserIds.length) {
      return NextResponse.json({ error: 'Every assigned person must be an active tenant user' }, { status: 422 });
    }
  }

  const requiredPermissions = [...new Set(
    definitionSteps
      .map((step) => step.requiredPermission)
      .filter((value): value is string => Boolean(value)),
  )];
  const permissionGrants = uniqueAssignedUserIds.length && requiredPermissions.length
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
        .where(and(
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(tenantMemberships.status, 'active'),
          inArray(tenantMemberships.userId, uniqueAssignedUserIds),
          inArray(rolePermissions.permissionCode, requiredPermissions),
        ))
    : [];

  const now = new Date();
  const activeGrantKeys = new Set(
    permissionGrants
      .filter((grant) => grant.startDate <= now && (!grant.endDate || grant.endDate > now))
      .map((grant) => `${grant.userId}:${grant.permissionCode}`),
  );
  const stepById = new Map(definitionSteps.map((step) => [step.id, step]));
  for (const submitted of submittedSteps) {
    const assignedUserId = typeof submitted.assignedUserId === 'string' && submitted.assignedUserId
      ? submitted.assignedUserId
      : null;
    if (!assignedUserId) continue;
    const step = stepById.get(String(submitted.id));
    if (step?.requiredPermission && !activeGrantKeys.has(`${assignedUserId}:${step.requiredPermission}`)) {
      return NextResponse.json(
        { error: `${step.label} can only be assigned to an active user who holds ${step.requiredPermission}.` },
        { status: 422 },
      );
    }
  }

  await db
    .update(workflowDefinitions)
    .set({
      regionId: body.regionId || null,
      officeId: body.officeId || null,
      departmentId: body.departmentId || null,
      updatedAt: new Date(),
    })
    .where(eq(workflowDefinitions.id, definition.id));

  for (const step of submittedSteps) {
    const stepId = String(step.id);
    const assignedUserId = typeof step.assignedUserId === 'string' && step.assignedUserId
      ? step.assignedUserId
      : null;
    await db
      .update(workflowSteps)
      .set({ assignedUserId })
      .where(and(eq(workflowSteps.id, stepId), eq(workflowSteps.definitionId, definition.id)));
  }

  await db.insert(auditEvents).values({
    tenantId: session.tenantId,
    tenantSequence: Date.now(),
    eventType: 'workflow_routing_updated',
    actorUserId: session.user.id,
    action: 'update',
    entityType: 'workflow_definition',
    entityId: definition.id,
    summary: 'Approval routing and assigned people updated',
    after: {
      regionId: body.regionId || null,
      officeId: body.officeId || null,
      departmentId: body.departmentId || null,
      steps: submittedSteps,
    },
  });

  return NextResponse.json({ success: true });
}
