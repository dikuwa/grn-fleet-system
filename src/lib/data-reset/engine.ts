/**
 * Development Data Reset — engine
 *
 * Orchestrates a controlled, tenant-aware development data reset:
 *
 *   guard → plan → (dry-run report | backup → execute → storage → integrity
 *   → audit → report)
 *
 * Execution is transactional when the active driver supports it (local
 * postgres.js); for the stateless Neon HTTP driver it runs as a *controlled
 * staged process*: the plan is fixed up front, each step is scoped to the
 * tenant, and a failed step aborts the remaining steps and produces a clear
 * error report. Re-running is safe because every step is idempotent.
 */
import { getDb } from '@/db';
import { checkConfirmationPhrase, checkResetAllowed } from './guard';
import { buildResetPlan, resolveStepCondition, type ResetDb, type ResetPlan } from './plan';
import { writeResetBackup, type BackupResult } from './backup';
import { runIntegrityChecks, criticalChecksPassed } from './integrity';
import {
  recordResetAuditEvent,
  writeReportFile,
  type ResetReport,
  type StepOutcome,
} from './report';
import { deleteFile, isStorageConfigured } from '@/lib/storage';
import {
  DATA_RESET_CONFIRMATION_PHRASE,
  OPERATIONAL_DELETE_STEPS,
  quoteTable,
  type ResetMode,
} from './config';
export type { ResetMode } from './config';
import { sql } from 'drizzle-orm';

export interface ResetOptions {
  tenantId: string;
  mode: ResetMode;
  dryRun: boolean;
  initiator?: string;
  confirmPhrase?: string;
  /** Optional injected env overrides for tests. */
  envOverrides?: Record<string, string | undefined>;
  /** Optional injected db for tests. */
  dbOverride?: ResetDb;
  /** Skip storage deletion (used by tests). */
  skipStorage?: boolean;
  /** Skip writing backup/report files to disk (used by tests). */
  skipFiles?: boolean;
}

export interface ResetOutcome {
  report: ResetReport;
  plan: ResetPlan;
  backup?: BackupResult;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function guardFor(opts: ResetOptions) {
  const env = opts.envOverrides ?? (process.env as Record<string, string | undefined>);
  const allowed = checkResetAllowed(env);
  if (!allowed.allowed) {
    return { allowed, confirmErrors: [] as string[] };
  }
  if (!opts.dryRun) {
    const confirm = checkConfirmationPhrase(opts.confirmPhrase);
    return { allowed, confirmErrors: confirm.errors };
  }
  return { allowed, confirmErrors: [] as string[] };
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

async function deleteStep(
  db: ResetDb,
  plan: ResetPlan,
  table: string,
): Promise<number> {
  const condition = resolveStepCondition(
    { table, label: '', scope: scopeForTable(table) },
    plan.ids,
    plan.tenantId,
  );
  if (!condition) return 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = sql`DELETE FROM ${sql.raw(quoteTable(table))} WHERE ${condition}` as any;
  await db.execute(query);
  return 1;
}

function scopeForTable(
  table: string,
): (typeof OPERATIONAL_DELETE_STEPS)[number]['scope'] {
  return OPERATIONAL_STEP_SCOPES[table] ?? 'tenant';
}

const OPERATIONAL_STEP_SCOPES: Record<string, (typeof OPERATIONAL_DELETE_STEPS)[number]['scope']> =
  Object.fromEntries(
    OPERATIONAL_DELETE_STEPS.map((step) => [step.table, step.scope]),
  );

// ---------------------------------------------------------------------------
// Storage cleanup
// ---------------------------------------------------------------------------

async function removeStorageFiles(
  fileKeys: string[],
  plan: ResetPlan,
  skip: boolean,
): Promise<{ removed: string[]; skipped: number }> {
  const removed: string[] = [];
  let skipped = 0;
  if (skip || !isStorageConfigured()) {
    skipped = fileKeys.length;
    return { removed, skipped };
  }
  for (const key of fileKeys) {
    try {
      await deleteFile(key);
      removed.push(key);
    } catch {
      // Never fail the whole reset because a single storage delete failed —
      // record it and let the operator investigate.
      skipped += 1;
    }
  }
  return { removed, skipped };
}

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

function summarize(plan: ResetPlan): ResetReport['dryRunSummary'] {
  const byId = (ids: string[]) => ids.length;
  const requests = byId(plan.ids.requestIds);
  const trips = byId(plan.ids.tripIds);
  const documents = byId(plan.ids.generatedDocumentIds);
  const notifications = byId(plan.ids.notificationIds);
  const total = plan.steps.reduce((sum, step) => sum + step.before, 0);
  return { requests, trips, documents, notifications, total };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Run a development data reset (dry-run or execute) for a single tenant.
 */
export async function runDevelopmentDataReset(
  opts: ResetOptions,
): Promise<ResetOutcome> {
  const db = opts.dbOverride ?? (getDb() as unknown as ResetDb);
  const env = opts.envOverrides ?? (process.env as Record<string, string | undefined>);
  const initiator = opts.initiator ?? env.DATA_RESET_INITIATOR ?? 'cli';
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const resetId = `data-reset-${timestamp}-${opts.tenantId.slice(0, 8)}`;

  const environment =
    env.VERCEL_ENV || env.NODE_ENV || env.RAILWAY_ENVIRONMENT || 'development';

  // 1. Guards
  const { allowed, confirmErrors } = guardFor(opts);
  if (!allowed.allowed || (!opts.dryRun && confirmErrors.length > 0)) {
    const report: ResetReport = {
      resetId,
      mode: opts.mode,
      dryRun: opts.dryRun,
      environment,
      database: '',
      timestamp: new Date().toISOString(),
      initiator,
      tenantId: opts.tenantId,
      tenantName: '',
      tenantCode: '',
      confirmationPhraseProvided: !opts.dryRun && (opts.confirmPhrase ?? '') === DATA_RESET_CONFIRMATION_PHRASE,
      dryRunSummary: { requests: 0, trips: 0, documents: 0, notifications: 0, total: 0 },
      steps: [],
      preserved: [],
      review: [],
      storageFilesRemoved: [],
      storageFilesSkipped: 0,
      integrity: [],
      errors: [...allowed.errors, ...confirmErrors],
      warnings: allowed.warnings,
      result: 'failed',
    };
    if (!opts.skipFiles) {
      await writeReportFile(report);
    }
    return { report, plan: null as unknown as ResetPlan };
  }

  // 2. Plan (never mutates)
  const plan = await buildResetPlan(db, {
    tenantId: opts.tenantId,
    mode: opts.mode,
    dryRun: opts.dryRun,
    timestamp,
  });

  // 3. Integrity snapshot (informational for dry-run; post-execute for execute)
  const integrityPre = opts.dryRun
    ? await runIntegrityChecks(db, opts.tenantId)
    : [];

  // 4. Dry-run → report and stop
  if (opts.dryRun) {
    const dryRunSteps: StepOutcome[] = plan.steps.map((step) => ({
      table: step.table,
      label: step.label,
      planned: step.before,
      removed: 0,
    }));
    const report: ResetReport = {
      resetId,
      mode: opts.mode,
      dryRun: true,
      environment,
      database: plan.database,
      timestamp: new Date().toISOString(),
      initiator,
      tenantId: plan.tenantId,
      tenantName: plan.tenantName,
      tenantCode: plan.tenantCode,
      confirmationPhraseProvided: false,
      dryRunSummary: summarize(plan),
      steps: dryRunSteps,
      preserved: plan.preserved,
      review: plan.review,
      storageFilesRemoved: [],
      storageFilesSkipped: plan.fileKeys.length,
      integrity: integrityPre,
      errors: [],
      warnings: allowed.warnings,
      result: 'dry_run',
    };
    if (!opts.skipFiles) {
      await writeReportFile(report);
      await recordResetAuditEvent(report, opts.tenantId);
    }
    return { report, plan };
  }

  // 5. Backup before deletion
  const backup = opts.skipFiles ? undefined : await writeResetBackup(db, plan);

  // 6. Execute — transaction when supported, otherwise controlled staging.
  const stepOutcomes: StepOutcome[] = [];
  const errors: string[] = [];
  let aborted = false;

  const executeSteps = async (executor: ResetDb): Promise<void> => {
    for (const step of plan.steps) {
      if (step.before === 0) {
        stepOutcomes.push({ table: step.table, label: step.label, planned: 0, removed: 0 });
        continue;
      }
      if (aborted) {
        stepOutcomes.push({ table: step.table, label: step.label, planned: step.before, removed: 0 });
        continue;
      }
      try {
        await deleteStep(executor, plan, step.table);
        stepOutcomes.push({ table: step.table, label: step.label, planned: step.before, removed: step.before });
      } catch (error) {
        aborted = true;
        stepOutcomes.push({ table: step.table, label: step.label, planned: step.before, removed: 0 });
        errors.push(
          `Step failed for ${step.table}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };

  // The neon-http driver *exposes* transaction() but throws
  // "No transactions support in neon-http driver" before running the
  // callback — so mere presence is not a capability check. When that happens
  // we fall back to the controlled staged process instead of treating it as
  // a rollback.
  try {
    if (typeof db.transaction === 'function') {
      try {
        await db.transaction(async (tx) => {
          await executeSteps(tx as ResetDb);
          if (aborted) {
            throw new Error('Reset aborted mid-transaction — rolling back all database changes.');
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('No transactions support')) {
          // Driver advertises transactions but does not implement them.
          await executeSteps(db);
        } else {
          throw error;
        }
      }
    } else {
      await executeSteps(db);
    }
  } catch (error) {
    errors.push(
      `Transaction aborted: ${error instanceof Error ? error.message : String(error)}. All database changes were rolled back.`,
    );
    stepOutcomes.forEach((step) => {
      step.removed = 0;
    });
  }

  // 7. Storage cleanup (only after DB steps committed without aborting)
  let storageRemoved: string[] = [];
  let storageSkipped = 0;
  if (aborted || errors.length > 0) {
    storageSkipped = plan.fileKeys.length;
  } else {
    const storage = await removeStorageFiles(plan.fileKeys, plan, opts.skipStorage ?? false);
    storageRemoved = storage.removed;
    storageSkipped = storage.skipped;
  }

  // 8. Integrity checks after execution
  const integrity = await runIntegrityChecks(db, opts.tenantId);
  const criticalPassed = criticalChecksPassed(integrity);
  const result: ResetReport['result'] = aborted
    ? 'failed'
    : errors.length > 0
      ? 'failed'
      : criticalPassed
        ? 'completed'
        : 'failed';

  if (aborted) {
    errors.push('Reset aborted before all steps completed. Database changes may be partial — inspect the backup and reports, then re-run the dry-run.');
  }
  if (!criticalPassed) {
    errors.push('One or more critical integrity checks failed after the reset.');
  }

  const report: ResetReport = {
    resetId,
    mode: opts.mode,
    dryRun: false,
    environment,
    database: plan.database,
    timestamp: new Date().toISOString(),
    initiator,
    tenantId: plan.tenantId,
    tenantName: plan.tenantName,
    tenantCode: plan.tenantCode,
    confirmationPhraseProvided: true,
    backup: backup ? { directory: backup.directory, records: backup.records } : undefined,
    // Total reflects rows actually removed; per-domain counts stay derived from
    // the plan (they equal removed when the run completes cleanly).
    dryRunSummary: {
      ...summarize(plan),
      total: stepOutcomes.reduce((sum, step) => sum + step.removed, 0),
    },
    steps: stepOutcomes,
    preserved: plan.preserved,
    review: plan.review,
    storageFilesRemoved: storageRemoved,
    storageFilesSkipped: storageSkipped,
    integrity,
    errors,
    warnings: allowed.warnings,
    result,
  };

  if (!opts.skipFiles) {
    await writeReportFile(report);
    await recordResetAuditEvent(report, opts.tenantId);
  }

  return { report, plan, backup };
}
