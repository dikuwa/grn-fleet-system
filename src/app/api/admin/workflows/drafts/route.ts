import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { workflowDefinitions, workflowSteps } from '@/db/schema/workflows';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import { validateGovernedActions } from '@/lib/workflow-builder';
import { recordAuditEvent } from '@/lib/audit-event';

function lifecycle(config: Record<string, unknown> | null | undefined) {
  return typeof config?.lifecycleStatus === 'string' ? config.lifecycleStatus : 'published';
}

export async function GET(req: NextRequest) {
  const auth = await requireRequestAuth(req);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const db = getDb();
  const rows = await db
    .select()
    .from(workflowDefinitions)
    .where(eq(workflowDefinitions.tenantId, auth.session.tenantId))
    .orderBy(desc(workflowDefinitions.updatedAt));
  return NextResponse.json({
    success: true,
    data: rows.map((row) => ({ ...row, lifecycleStatus: lifecycle(row.config) })),
  });
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const body = await req.json().catch(() => ({}));
    const sourceDefinitionId = typeof body.sourceDefinitionId === 'string' ? body.sourceDefinitionId : '';
    if (!sourceDefinitionId) return NextResponse.json({ error: 'sourceDefinitionId is required.' }, { status: 400 });

    const db = getDb();
    const [source] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, sourceDefinitionId), eq(workflowDefinitions.tenantId, auth.session.tenantId)))
      .limit(1);
    if (!source) return NextResponse.json({ error: 'Workflow definition not found.' }, { status: 404 });
    const sourceSteps = await db
      .select()
      .from(workflowSteps)
      .where(eq(workflowSteps.definitionId, source.id))
      .orderBy(workflowSteps.stepOrder);
    const [versionRow] = await db
      .select({ nextVersion: sql<number>`COALESCE(MAX(${workflowDefinitions.version}), 0) + 1` })
      .from(workflowDefinitions)
      .where(and(
        eq(workflowDefinitions.tenantId, auth.session.tenantId),
        eq(workflowDefinitions.tripScope, source.tripScope),
      ));
    const draftId = randomUUID();
    const now = new Date();
    const draftConfig = {
      ...(source.config ?? {}),
      lifecycleStatus: 'draft',
      sourceDefinitionId: source.id,
      createdByUserId: auth.session.user.id,
      createdAt: now.toISOString(),
      validatedAt: null,
      validatedByUserId: null,
      publishedAt: null,
    };
    await runAtomicMutations((tx) => [
      tx.insert(workflowDefinitions).values({
        id: draftId,
        tenantId: auth.session.tenantId,
        tripScope: source.tripScope,
        regionId: source.regionId,
        officeId: source.officeId,
        departmentId: source.departmentId,
        version: Number(versionRow?.nextVersion ?? source.version + 1),
        name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : `${source.name} Draft`,
        isActive: false,
        config: draftConfig,
      }),
      tx.insert(workflowSteps).values(
        sourceSteps.map((step) => ({
          definitionId: draftId,
          stepOrder: step.stepOrder,
          actionType: step.actionType,
          requiredPermission: step.requiredPermission,
          assignedUserId: step.assignedUserId,
          label: step.label,
          description: step.description,
          requiresComment: step.requiresComment,
          reminderAfterHours: step.reminderAfterHours,
          escalationAfterHours: step.escalationAfterHours,
          allowsEmergencyOverride: step.allowsEmergencyOverride,
          separationDutyRole: step.separationDutyRole,
          config: step.config,
        })),
      ),
    ]);
    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'workflow.draft_created',
      entityType: 'workflow_definition',
      entityId: draftId,
      summary: `Created workflow draft from ${source.name}.`,
      after: { sourceDefinitionId: source.id, version: versionRow?.nextVersion },
    });
    return NextResponse.json({ success: true, data: { id: draftId, lifecycleStatus: 'draft' } }, { status: 201 });
  } catch (error) {
    console.error('[Workflow Draft] POST failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to create workflow draft.' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const body = await req.json().catch(() => ({}));
    const definitionId = typeof body.definitionId === 'string' ? body.definitionId : '';
    const action = typeof body.action === 'string' ? body.action : '';
    if (!definitionId || !['validate', 'publish'].includes(action)) {
      return NextResponse.json({ error: 'definitionId and validate/publish action are required.' }, { status: 400 });
    }

    const db = getDb();
    const [definition] = await db
      .select()
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.tenantId, auth.session.tenantId)))
      .limit(1);
    if (!definition) return NextResponse.json({ error: 'Workflow draft not found.' }, { status: 404 });
    if (definition.isActive) return NextResponse.json({ error: 'Active workflow definitions are immutable. Create a draft first.' }, { status: 409 });
    const steps = await db.select().from(workflowSteps).where(eq(workflowSteps.definitionId, definitionId)).orderBy(workflowSteps.stepOrder);
    const governed = validateGovernedActions(steps.map((step) => step.actionType));
    const warnings: string[] = [];
    if (!governed.ok) return NextResponse.json({ error: governed.error, validation: { valid: false, warnings } }, { status: 422 });
    if (!steps.length) return NextResponse.json({ error: 'Workflow draft has no steps.' }, { status: 422 });
    if (steps.some((step, index) => step.stepOrder !== index + 1)) {
      return NextResponse.json({ error: 'Workflow step order must be continuous starting at 1.' }, { status: 422 });
    }
    if (steps.some((step) => step.config && (step.config as Record<string, unknown>).assignmentStrategy === 'named_user' && !step.assignedUserId)) {
      return NextResponse.json({ error: 'Every named-person assignment must select an eligible person.' }, { status: 422 });
    }
    if (steps.some((step) => !step.assignedUserId && (step.config as Record<string, unknown> | null)?.assignmentStrategy !== 'permission_pool')) {
      warnings.push('One or more steps rely on runtime fallback resolution; use Route Preview with a submitted request before publishing.');
    }

    const now = new Date();
    if (action === 'validate') {
      const nextConfig = {
        ...(definition.config ?? {}),
        lifecycleStatus: 'validated',
        validatedAt: now.toISOString(),
        validatedByUserId: auth.session.user.id,
        validationWarnings: warnings,
      };
      await db.update(workflowDefinitions).set({ config: nextConfig, updatedAt: now }).where(eq(workflowDefinitions.id, definition.id));
      await recordAuditEvent({
        tenantId: auth.session.tenantId,
        actorUserId: auth.session.user.id,
        action: 'workflow.draft_validated',
        entityType: 'workflow_definition',
        entityId: definition.id,
        summary: `Validated workflow draft ${definition.name}.`,
        after: { warnings },
      });
      return NextResponse.json({ success: true, data: { id: definition.id, lifecycleStatus: 'validated', warnings } });
    }

    if (lifecycle(definition.config) !== 'validated') {
      return NextResponse.json({ error: 'Validate this workflow draft before publishing it.' }, { status: 409 });
    }
    const sameScope = and(
      eq(workflowDefinitions.tenantId, auth.session.tenantId),
      eq(workflowDefinitions.tripScope, definition.tripScope),
      definition.regionId ? eq(workflowDefinitions.regionId, definition.regionId) : sql`${workflowDefinitions.regionId} IS NULL`,
      definition.officeId ? eq(workflowDefinitions.officeId, definition.officeId) : sql`${workflowDefinitions.officeId} IS NULL`,
      definition.departmentId ? eq(workflowDefinitions.departmentId, definition.departmentId) : sql`${workflowDefinitions.departmentId} IS NULL`,
      eq(workflowDefinitions.isActive, true),
    );
    const previous = await db.select().from(workflowDefinitions).where(sameScope);
    const publishConfig = {
      ...(definition.config ?? {}),
      lifecycleStatus: 'published',
      publishedAt: now.toISOString(),
      publishedByUserId: auth.session.user.id,
    };
    await runAtomicMutations((tx) => [
      ...previous.map((item) => tx.update(workflowDefinitions).set({
        isActive: false,
        updatedAt: now,
        config: { ...(item.config ?? {}), lifecycleStatus: 'superseded', supersededAt: now.toISOString(), supersededByDefinitionId: definition.id },
      }).where(eq(workflowDefinitions.id, item.id))),
      tx.update(workflowDefinitions).set({ isActive: true, config: publishConfig, updatedAt: now }).where(eq(workflowDefinitions.id, definition.id)),
    ]);
    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'workflow.published',
      entityType: 'workflow_definition',
      entityId: definition.id,
      summary: `Published workflow ${definition.name} version ${definition.version}.`,
      before: { supersededDefinitionIds: previous.map((item) => item.id) },
      after: { version: definition.version, lifecycleStatus: 'published' },
    });
    return NextResponse.json({ success: true, data: { id: definition.id, lifecycleStatus: 'published', version: definition.version } });
  } catch (error) {
    console.error('[Workflow Draft] PATCH failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unable to update workflow draft lifecycle.' }, { status: 500 });
  }
}
