import { createHash } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackups } from '@/db/schema/data-protection';
import { tenantResetRequests, resetRequestSteps } from '@/db/schema/reset-requests';
import { tenants } from '@/db/schema/tenants';
import { OPERATIONAL_DELETE_STEPS, quoteTable } from '@/lib/data-reset/config';
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
): Promise<{ preview: ResetPreview; plan: ResetPlan }> {
  const db = getDb();
  const plan = await buildResetPlan(db as unknown as ResetDb, {
    tenantId,
    mode: 'operational',
    dryRun: true,
    timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
  });
  const preview: ResetPreview = {
    tenantId: plan.tenantId,
    tenantName: plan.tenantName,
    tenantCode: plan.tenantCode,
    dryRunSummary: summarizePlan(plan),
    steps: plan.steps.map((step) => ({
      table: step.table,
      label: step.label,
      planned: step.before,
    })),
    preserved: plan.preserved,
    review: plan.review,
    fingerprint: resetPlanFingerprint(plan),
    plannedAt: new Date().toISOString(),
  };
  return { preview, plan };
}

async function deleteStep(db: ResetDb, plan: ResetPlan, table: string) {
  const configured = OPERATIONAL_DELETE_STEPS.find((step) => step.table === table);
  if (!configured)
    throw new Error(`Reset table ${table} is not in the approved operational reset registry`);
  const condition = resolveStepCondition(configured, plan.ids, plan.tenantId);
  if (!condition) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.execute(sql`DELETE FROM ${sql.raw(quoteTable(table))} WHERE ${condition}` as any);
}

export async function executeApprovedTenantOperationalReset(input: {
  resetRequestId: string;
  actorUserId: string;
  actorTenantId: string;
  confirmationPhrase: string;
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
  if (resetRequest.scope !== 'operational') {
    throw new Error(
      'Only the tenant operational reset is supported for production-safe execution. Create a new operational reset request.',
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

  const metadata = (resetRequest.metadata ?? {}) as Record<string, unknown>;
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

  const { preview: freshPreview, plan } = await previewTenantOperationalReset(
    resetRequest.tenantId,
  );
  if (
    freshPreview.fingerprint !== storedFingerprint ||
    freshPreview.dryRunSummary.total !== Number(storedSummary.total ?? -1)
  ) {
    await db
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
          resetInvalidatedAt: new Date().toISOString(),
          resetInvalidatedReason: 'Operational data changed after dry run.',
        },
        updatedAt: new Date(),
      })
      .where(eq(tenantResetRequests.id, resetRequest.id));
    throw new Error(
      'Operational data changed after the dry run. Run the dry run again and create a new recovery point before executing.',
    );
  }

  await db.delete(resetRequestSteps).where(eq(resetRequestSteps.resetRequestId, resetRequest.id));
  await db
    .update(tenantResetRequests)
    .set({
      status: 'in_progress',
      startedAt: new Date(),
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(tenantResetRequests.id, resetRequest.id));

  const startedAt = Date.now();
  const outcomes: Array<{
    table: string;
    label: string;
    planned: number;
    removed: number;
    error?: string;
  }> = [];
  let failed = false;

  for (const step of plan.steps) {
    if (failed) {
      outcomes.push({
        table: step.table,
        label: step.label,
        planned: step.before,
        removed: 0,
        error: 'Skipped after earlier failure',
      });
      continue;
    }
    if (step.before === 0) {
      outcomes.push({ table: step.table, label: step.label, planned: 0, removed: 0 });
      continue;
    }
    try {
      await deleteStep(db as unknown as ResetDb, plan, step.table);
      outcomes.push({
        table: step.table,
        label: step.label,
        planned: step.before,
        removed: step.before,
      });
    } catch (error) {
      failed = true;
      outcomes.push({
        table: step.table,
        label: step.label,
        planned: step.before,
        removed: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
        dryRunSummary: { ...freshPreview.dryRunSummary, total: totalRemoved },
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
    summary: `${requestRow.tenantName} operational reset ${success ? 'completed' : 'failed'}; ${totalRemoved} rows removed; recovery point ${backup.id} retained.`,
    after: {
      scope: resetRequest.scope,
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
