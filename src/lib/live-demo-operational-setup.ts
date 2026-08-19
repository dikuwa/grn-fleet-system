import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { rolePermissions, roles } from '@/db/schema/tenants';
import { workflowDefinitions, workflowSteps } from '@/db/schema/workflows';
import { Permissions } from '@/lib/permissions';
import { seedTenantOperationalDefaults } from '@/lib/platform/tenant-operational-defaults';
import { governedStage, normalizeAssignmentConfig } from '@/lib/workflow-builder';
import { runAtomicMutations } from '@/lib/db-atomic';

const LIVE_DEMO_APPROVER_MARKER = 'Public live demo: approver';
const STANDARD_DEMO_ACTIONS = [
  'supervisor_approve',
  'transport_review',
  'authorise',
  'acknowledge',
] as const;

async function ensureApproverAuthorityPermissions(tenantId: string) {
  const db = getDb();
  const [approverRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, tenantId), eq(roles.description, LIVE_DEMO_APPROVER_MARKER)))
    .limit(1);
  if (!approverRole) {
    throw new Error('Live demo approver role was not created before workflow setup.');
  }

  const required = [Permissions.TRIP_AUTHORIZE_REGIONAL, Permissions.TRIP_AUTHORIZE_NATIONAL];
  const existing = await db
    .select({ permissionCode: rolePermissions.permissionCode })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, approverRole.id),
        inArray(rolePermissions.permissionCode, required),
      ),
    );
  const existingCodes = new Set(existing.map((row) => row.permissionCode));
  const missing = required.filter((code) => !existingCodes.has(code));
  if (missing.length > 0) {
    await db
      .insert(rolePermissions)
      .values(missing.map((permissionCode) => ({ roleId: approverRole.id, permissionCode })));
  }
}

async function ensureWorkflow(tenantId: string, tripScope: 'regional' | 'national') {
  const db = getDb();
  const name = `Live Demo ${tripScope === 'regional' ? 'Regional' : 'National'} Workflow`;
  const [existing] = await db
    .select({ id: workflowDefinitions.id })
    .from(workflowDefinitions)
    .where(
      and(
        eq(workflowDefinitions.tenantId, tenantId),
        eq(workflowDefinitions.name, name),
        eq(workflowDefinitions.isActive, true),
      ),
    )
    .limit(1);

  if (existing) {
    const steps = await db
      .select({ id: workflowSteps.id })
      .from(workflowSteps)
      .where(eq(workflowSteps.definitionId, existing.id));
    if (steps.length === STANDARD_DEMO_ACTIONS.length) return existing.id;
    await db.delete(workflowSteps).where(eq(workflowSteps.definitionId, existing.id));
    await db
      .update(workflowDefinitions)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(workflowDefinitions.id, existing.id));
  }

  const definitionId = randomUUID();
  const now = new Date();
  const stepValues = STANDARD_DEMO_ACTIONS.map((actionType, index) => {
    const stage = governedStage(actionType, tripScope);
    return {
      id: randomUUID(),
      definitionId,
      stepOrder: index + 1,
      actionType,
      requiredPermission: stage.requiredPermission,
      assignedUserId: null,
      label: stage.label,
      description: stage.description,
      requiresComment: actionType === 'authorise' && tripScope === 'national',
      reminderAfterHours: 2,
      escalationAfterHours: 4,
      allowsEmergencyOverride: actionType === 'authorise',
      separationDutyRole: ['supervisor_approve', 'transport_review'].includes(actionType)
        ? 'requester'
        : null,
      config: normalizeAssignmentConfig({ assignmentStrategy: 'permission_pool' }),
      createdAt: now,
    };
  });

  await runAtomicMutations((executor) => [
    executor.insert(workflowDefinitions).values({
      id: definitionId,
      tenantId,
      tripScope,
      version: 1,
      name,
      isActive: true,
      config: { preset: 'standard', isFallback: true, systemLiveDemo: true },
      createdAt: now,
      updatedAt: now,
    }),
    executor.insert(workflowSteps).values(stepValues),
  ]);
  return definitionId;
}

/**
 * Make the shared public demo operational, not just visually populated.
 *
 * Public demo personas are created first by publishLiveDemoSandbox. This helper
 * then gives the demo Approver the final-authority capabilities needed by the
 * standard demo routes, seeds universal tenant defaults, and creates tenant-wide
 * fallback regional/national workflows that resolve by permission pools.
 */
export async function ensureLiveDemoOperationalSetup(input: {
  tenantId: string;
  actorUserId: string;
}) {
  await seedTenantOperationalDefaults({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
  });
  await ensureApproverAuthorityPermissions(input.tenantId);
  const [regionalWorkflowId, nationalWorkflowId] = await Promise.all([
    ensureWorkflow(input.tenantId, 'regional'),
    ensureWorkflow(input.tenantId, 'national'),
  ]);
  return { regionalWorkflowId, nationalWorkflowId };
}
