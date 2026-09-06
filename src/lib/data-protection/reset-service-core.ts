import { createHash } from 'node:crypto';
import { and, eq, getTableName, sql } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { platformBackups } from '@/db/schema/data-protection';
import { tenantResetRequests, resetRequestSteps } from '@/db/schema/reset-requests';
import { tenants } from '@/db/schema/tenants';
import { OPERATIONAL_DELETE_STEPS } from '@/lib/data-reset/config';
import {
  buildResetPlan,
  resolveStepCondition,
  type ResetDb,
  type ResetPlan,
} from '@/lib/data-reset/plan';
import { criticalChecksPassed, runIntegrityChecks } from '@/lib/data-reset/integrity';
import { recordAuditEvent } from '@/lib/audit-event';
import { readBackupPayload } from './backup-service';
import {
  matchesTenantExecutionResetPhrase,
  tenantExecutionResetPhrase,
} from '@/lib/reset-workflow';
import { normalizeResetSpec, type ResetSpec } from '@/lib/reset-catalog';
import { resetExecutionOwner } from '@/lib/reset-workflow';
import { buildAdvancedResetPlan, type AdvancedResetPlan } from './advanced-reset-plan';
import { runAtomicMutations } from '@/lib/db-atomic';

export interface ResetPreview {
  tenantId: string;
  tenantName: string;
  tenantCode: string;
  dryRunSummary: {
    requests: number;
    trips: number;
    documents: number;
    notifications: number;
    total: number;
  };
  steps: Array<{ table: string; label: string; planned: number }>;
  preserved: ResetPlan['preserved'];
  review: ResetPlan['review'];
  fingerprint: string;
  plannedAt: string;
  resetSpec: ResetSpec;
  categoryCounts: AdvancedResetPlan['categoryCounts'];
  protected: readonly string[];
}

function summarizePlan(plan: ResetPlan): ResetPreview['dryRunSummary'] {
  return {
    requests: plan.ids.requestIds.length,
    trips: plan.ids.tripIds.length,
    documents: plan.ids.generatedDocumentIds.length,
    notifications: plan.ids.notificationIds.length,
    total: plan.steps.reduce((sum, step) => sum + step.before, 0),
  };
}

export function resetPlanFingerprint(plan: ResetPlan) {
  const stable = JSON.stringify({
    tenantId: plan.tenantId,
    ids: {
      requests: [...plan.ids.requestIds].sort(),
      trips: [...plan.ids.tripIds].sort(),
      allocations: [...plan.ids.allocationIds].sort(),
      authorities: [...plan.ids.authorityIds].sort(),
      inspections: [...plan.ids.inspectionIds].sort(),
      fuel: [...plan.ids.fuelTransactionIds].sort(),
      workflows: [...plan.ids.workflowInstanceIds].sort(),
      documents: [...plan.ids.generatedDocumentIds].sort(),
      notifications: [...plan.ids.notificationIds].sort(),
    },
    steps: plan.steps.map((step) => [step.table, step.before]),
  });
  return createHash('sha256').update(stable).digest('hex');
}

export async function previewTenantOperationalReset(
  tenantId: string,
  resetSpecInput?: unknown,
): Promise<{ preview: ResetPreview; plan: ResetPlan; advancedPlan: AdvancedResetPlan }> {
  const db = getDb();
  const resetSpec = normalizeResetSpec(resetSpecInput, { target: 'tenant' });
  const plan = await buildResetPlan(db as unknown as ResetDb, {
    tenantId,
    mode: 'operational',
    dryRun: true,
    timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
    cutoff: resetSpec.cutoff ? new Date(resetSpec.cutoff) : null,
  });
  const advancedPlan = await buildAdvancedResetPlan({ tenantId, resetSpec, operationalPlan: plan });
  const operationalTotal = resetSpec.categories.includes('operations')
    ? plan.steps.reduce((sum, step) => sum + step.before, 0)
    : 0;
  const operationalFingerprint = resetPlanFingerprint(plan);
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        operationalFingerprint,
        advancedFingerprint: advancedPlan.fingerprint,
        resetSpec,
      }),
    )
    .digest('hex');
  const preview: ResetPreview = {
    tenantId: plan.tenantId,
    tenantName: plan.tenantName,
    tenantCode: plan.tenantCode,
    dryRunSummary: {
      ...summarizePlan(plan),
      requests: resetSpec.categories.includes('operations') ? plan.ids.requestIds.length : 0,
      trips: resetSpec.categories.includes('operations') ? plan.ids.tripIds.length : 0,
      documents:
        (resetSpec.categories.includes('operations') ? plan.ids.generatedDocumentIds.length : 0) +
        (advancedPlan.categoryCounts.documents ?? 0),
      notifications: resetSpec.categories.includes('operations')
        ? plan.ids.notificationIds.length
        : 0,
      total: operationalTotal + advancedPlan.total,
    },
    steps: [
      ...(resetSpec.categories.includes('operations') ? plan.steps : []),
      ...advancedPlan.steps,
    ].map((step) => ({
      table: step.table,
      label: step.label,
      planned: step.before,
    })),
    preserved: plan.preserved,
    review: plan.review,
    fingerprint,
    plannedAt: new Date().toISOString(),
    resetSpec,
    categoryCounts: {
      ...advancedPlan.categoryCounts,
      operations: operationalTotal,
    },
    protected: advancedPlan.protected,
  };
  return { preview, plan, advancedPlan };
}

function resetTable(name: string) {
  for (const candidate of Object.values(schema)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (getTableName(candidate as any) === name) return candidate;
    } catch {
      // Non-table schema exports (enums/relations) are intentionally ignored.
    }
  }
  throw new Error(`Reset table ${name} is not registered in the application schema`);
}

async function executeResetPlanAtomically(
  plan: ResetPlan,
  advancedPlan: AdvancedResetPlan,
  resetSpec: ResetSpec,
) {
  await runAtomicMutations((executor) => {
    const mutations: unknown[] = [];
    if (resetSpec.categories.includes('operations')) {
      // Closed-trip financial rows are immutable during ordinary application use.
      // A governed reset is the sole exception: approval, a matching dry run,
      // typed confirmation and a verified recovery point are all checked before
      // this transaction begins. set_config(..., true) keeps the exception local
      // to this atomic transaction and cannot leak into later requests.
      mutations.push(
        executor.execute(sql`SELECT set_config('govfleet.governed_reset', 'on', true)`),
      );
      for (const step of OPERATIONAL_DELETE_STEPS) {
        if (!plan.steps.find((candidate) => candidate.table === step.table)?.before) continue;
        const condition = resolveStepCondition(step, plan.ids, plan.tenantId);
        if (condition) mutations.push(executor.delete(resetTable(step.table)).where(condition));
      }
    }
    for (const step of advancedPlan.steps) {
      if (step.before)
        mutations.push(executor.delete(resetTable(step.table)).where(step.condition));
    }
    return mutations;
  });
}

export async function executeApprovedTenantOperationalReset(input: {
  resetRequestId: string;
  actorUserId: string;
  actorTenantId?: string;
  confirmationPhrase: string;
  onStarted?: (context: {
    requestId: string;
    tenantId: string;
    requesterUserId: string;
    tenantOrigin: boolean;
  }) => Promise<void>;
}) {
  const db = getDb();
  const [requestRow] = await db
    .select({
      request: tenantResetRequests,
      tenantName: tenants.name,
      tenantCode: tenants.code,
    })
    .from(tenantResetRequests)
    .innerJoin(tenants, eq(tenantResetRequests.tenantId, tenants.id))
    .where(eq(tenantResetRequests.id, input.resetRequestId))
    .limit(1);

  if (!requestRow) throw new Error('Reset request not found');
  const resetRequest = requestRow.request;
  const metadata = (resetRequest.metadata ?? {}) as Record<string, unknown>;
  const resetSpec = normalizeResetSpec(metadata.resetSpec, { target: 'tenant' });
  if (input.actorTenantId && resetRequest.tenantId !== input.actorTenantId) {
    throw new Error('Reset request not found');
  }
  if (
    input.actorTenantId &&
    resetExecutionOwner({ createdFrom: metadata.createdFrom, preset: resetSpec.preset }) !==
      'tenant'
  ) {
    throw new Error(
      'This reset remains Platform-executed. Tenant Administration can execute only tenant-originated operational or selective plans.',
    );
  }
  if (resetRequest.status !== 'approved')
    throw new Error('Reset request must be approved before execution');

  const expectedPhrase = tenantExecutionResetPhrase(requestRow.tenantCode);
  if (!matchesTenantExecutionResetPhrase(input.confirmationPhrase, requestRow.tenantCode)) {
    throw new Error(`Confirmation phrase is incorrect. Type exactly: ${expectedPhrase}`);
  }

  const validation = (resetRequest.validationResults ?? {}) as Record<string, unknown>;
  const storedFingerprint =
    typeof validation.fingerprint === 'string' ? validation.fingerprint : null;
  const storedSummary = validation.dryRunSummary as { total?: unknown } | undefined;
  if (!storedFingerprint || !storedSummary)
    throw new Error('Run a fresh dry run before executing this reset');

  const backupSnapshotId =
    typeof metadata.backupSnapshotId === 'string' ? metadata.backupSnapshotId : null;
  if (!resetRequest.backupCreated || !backupSnapshotId || !resetRequest.backupLocation) {
    throw new Error('Create a durable recovery point before executing this reset');
  }

  const [backup] = await db
    .select()
    .from(platformBackups)
    .where(eq(platformBackups.id, backupSnapshotId))
    .limit(1);
  if (!backup || backup.status !== 'ready' || backup.resetRequestId !== resetRequest.id) {
    throw new Error(
      'The linked recovery point is not ready. Create a new recovery point before reset.',
    );
  }
  // This also downloads and verifies the archive checksum/tenant identity before deletion begins.
  await readBackupPayload(backup.id);

  const {
    preview: freshPreview,
    plan,
    advancedPlan,
  } = await previewTenantOperationalReset(resetRequest.tenantId, resetSpec);
  if (
    freshPreview.fingerprint !== storedFingerprint ||
    freshPreview.dryRunSummary.total !== Number(storedSummary.total ?? -1)
  ) {
    const invalidatedAt = new Date();
    const [invalidated] = await db
      .update(tenantResetRequests)
      .set({
        backupCreated: false,
        backupLocation: null,
        backupSizeBytes: null,
        backupRecordCount: null,
        rollbackPossible: false,
        metadata: {
          ...metadata,
          backupSnapshotId: null,
          resetInvalidatedAt: invalidatedAt.toISOString(),
          resetInvalidatedReason: 'Selected data changed after dry run.',
        },
        updatedAt: invalidatedAt,
      })
      .where(
        and(
          eq(tenantResetRequests.id, resetRequest.id),
          eq(tenantResetRequests.status, 'approved'),
          eq(tenantResetRequests.updatedAt, resetRequest.updatedAt),
        ),
      )
      .returning({ id: tenantResetRequests.id });

    if (!invalidated) {
      throw new Error(
        'This reset request changed after execution validation. Refresh the request and review its current state before retrying.',
      );
    }
    throw new Error(
      'Selected data changed after the dry run. Run the dry run again and create a new recovery point before executing.',
    );
  }

  const executionStartedAt = new Date();
  const executionClaimed = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(tenantResetRequests)
      .set({
        status: 'in_progress',
        startedAt: executionStartedAt,
        failureReason: null,
        updatedAt: executionStartedAt,
      })
      .where(
        and(
          eq(tenantResetRequests.id, resetRequest.id),
          eq(tenantResetRequests.status, 'approved'),
          eq(tenantResetRequests.updatedAt, resetRequest.updatedAt),
        ),
      )
      .returning({ id: tenantResetRequests.id });

    if (!claimed) return false;

    await tx.delete(resetRequestSteps).where(eq(resetRequestSteps.resetRequestId, resetRequest.id));
    return true;
  });

  if (!executionClaimed) {
    throw new Error(
      'This reset request changed after execution validation. Refresh the request and review its current state before retrying.',
    );
  }

  await input
    .onStarted?.({
      requestId: resetRequest.id,
      tenantId: resetRequest.tenantId,
      requesterUserId: resetRequest.requestedByUserId,
      tenantOrigin: metadata.createdFrom === 'tenant_admin',
    })
    .catch((error) => {
      console.error('[Tenant Reset] Could not send execution-start notification:', error);
    });

  const startedAt = Date.now();
  const outcomes: Array<{
    table: string;
    label: string;
    planned: number;
    removed: number;
    error?: string;
  }> = [];
  let failed = false;
  try {
    await executeResetPlanAtomically(plan, advancedPlan, resetSpec);
    const completedSteps = [
      ...(resetSpec.categories.includes('operations') ? plan.steps : []),
      ...advancedPlan.steps,
    ];
    completedSteps.forEach((step) =>
      outcomes.push({
        table: step.table,
        label: step.label,
        planned: step.before,
        removed: step.before,
      }),
    );
  } catch (error) {
    failed = true;
    outcomes.push({
      table: 'reset_plan',
      label: 'Atomic reset plan',
      planned: freshPreview.dryRunSummary.total,
      removed: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const integrity = await runIntegrityChecks(db as unknown as ResetDb, resetRequest.tenantId);
  const integrityPassed = criticalChecksPassed(integrity);
  const success = !failed && integrityPassed;
  const completedAt = new Date();

  for (const [index, outcome] of outcomes.entries()) {
    await db.insert(resetRequestSteps).values({
      resetRequestId: resetRequest.id,
      stepOrder: index,
      stepName: outcome.label,
      tableName: outcome.table,
      recordsDeleted: outcome.removed,
      recordsPreserved: Math.max(0, outcome.planned - outcome.removed),
      status: outcome.error ? 'failed' : 'completed',
      startedAt: new Date(startedAt),
      completedAt,
      error: outcome.error ?? null,
      details: { planned: outcome.planned, removed: outcome.removed },
    });
  }

  const totalRemoved = outcomes.reduce((sum, outcome) => sum + outcome.removed, 0);
  const failureReason = success
    ? null
    : outcomes.find((outcome) => outcome.error)?.error ||
      'One or more critical integrity checks failed after reset.';

  await db
    .update(tenantResetRequests)
    .set({
      status: success ? 'completed' : 'failed',
      completedAt,
      executionTimeMs: Date.now() - startedAt,
      results: {
        // Keep the reviewed impact immutable. A failed atomic plan removes zero
        // rows, but must not rewrite its reviewed impact to look like a zero-row
        // request in history.
        dryRunSummary: freshPreview.dryRunSummary,
        totalRemoved,
        steps: outcomes,
        preserved: freshPreview.preserved,
        review: freshPreview.review,
        integrity,
        storageFilesRemoved: [],
        storageFilesPreserved: plan.fileKeys.length,
      },
      failureReason,
      rollbackPossible: true,
      updatedAt: completedAt,
    })
    .where(eq(tenantResetRequests.id, resetRequest.id));

  await recordAuditEvent({
    tenantId: resetRequest.tenantId,
    actorUserId: input.actorUserId,
    action: 'reset_request.executed',
    entityType: 'reset_request',
    entityId: resetRequest.id,
    summary: `${requestRow.tenantName} reset plan ${success ? 'completed' : 'failed'}; ${totalRemoved} rows removed; recovery point ${backup.id} retained.`,
    after: {
      scope: resetRequest.scope,
      resetSpec,
      result: success ? 'completed' : 'failed',
      totalRemoved,
      backupSnapshotId: backup.id,
      backupStorageKey: backup.storageKey,
      integrityPassed,
    },
  });

  return {
    result: success ? ('completed' as const) : ('failed' as const),
    tenantId: resetRequest.tenantId,
    tenantName: requestRow.tenantName,
    tenantCode: requestRow.tenantCode,
    requesterUserId: resetRequest.requestedByUserId,
    tenantOrigin:
      (resetRequest.metadata as Record<string, unknown> | null)?.createdFrom === 'tenant_admin',
    totalRemoved,
    backupSnapshotId: backup.id,
    outcomes,
    integrity,
  };
}