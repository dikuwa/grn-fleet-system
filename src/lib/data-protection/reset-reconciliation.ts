import { and, eq, lt } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';

const DEFAULT_STALE_RESET_MINUTES = 60;
const MIN_STALE_RESET_MINUTES = 15;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RESET_IN_PROGRESS_STALE_MINUTES = Math.max(
  MIN_STALE_RESET_MINUTES,
  positiveNumber(process.env.RESET_IN_PROGRESS_STALE_MINUTES, DEFAULT_STALE_RESET_MINUTES),
);

type ResetExecutionEvidenceState = 'not_started' | 'committed' | 'unknown';

function executionEvidenceState(metadata: Record<string, unknown>): ResetExecutionEvidenceState {
  if (metadata.executionTransactionState === 'not_started') return 'not_started';
  if (metadata.executionTransactionState === 'committed') return 'committed';
  return 'unknown';
}

export interface ResetReconciliationResult {
  examined: number;
  reconciled: number;
  interruptedBeforeCommit: number;
  committedUnfinalized: number;
  unknownLegacy: number;
}

/**
 * Fail closed for reset executions that were left in `in_progress` after the
 * application worker disappeared.
 *
 * New executions carry transaction evidence in request metadata. The
 * `committed` marker is written in the same database transaction/batch as the
 * destructive delete plan, so reconciliation never has to infer whether rows
 * were removed. Legacy rows without this evidence are classified as unknown
 * and require manual recovery-point review rather than being guessed safe.
 */
export async function reconcileStaleInProgressResets(
  now = new Date(),
): Promise<ResetReconciliationResult> {
  const db = getDb();
  const staleBefore = new Date(
    now.getTime() - RESET_IN_PROGRESS_STALE_MINUTES * 60 * 1000,
  );

  const staleRows = await db
    .select({
      id: tenantResetRequests.id,
      tenantId: tenantResetRequests.tenantId,
      startedAt: tenantResetRequests.startedAt,
      metadata: tenantResetRequests.metadata,
      results: tenantResetRequests.results,
      rollbackPossible: tenantResetRequests.rollbackPossible,
    })
    .from(tenantResetRequests)
    .where(
      and(
        eq(tenantResetRequests.status, 'in_progress'),
        lt(tenantResetRequests.startedAt, staleBefore),
      ),
    );

  const result: ResetReconciliationResult = {
    examined: staleRows.length,
    reconciled: 0,
    interruptedBeforeCommit: 0,
    committedUnfinalized: 0,
    unknownLegacy: 0,
  };

  for (const row of staleRows) {
    if (!row.startedAt) continue;
    const metadata = (row.metadata ?? {}) as Record<string, unknown>;
    const existingResults = (row.results ?? {}) as Record<string, unknown>;
    const evidence = executionEvidenceState(metadata);
    const reconciledAt = new Date();

    let classification: 'interrupted_before_commit' | 'committed_unfinalized' | 'unknown_legacy';
    let destructivePlanCommitted: boolean | null;
    let failureReason: string;

    if (evidence === 'not_started') {
      classification = 'interrupted_before_commit';
      destructivePlanCommitted = false;
      failureReason =
        'Reset execution worker stopped before the destructive transaction committed. No destructive commit was recorded.';
    } else if (evidence === 'committed') {
      classification = 'committed_unfinalized';
      destructivePlanCommitted = true;
      failureReason =
        'Reset destructive transaction committed, but execution finalization did not complete. Review the retained recovery point and integrity state before further action.';
    } else {
      classification = 'unknown_legacy';
      destructivePlanCommitted = null;
      failureReason =
        'A stale legacy reset execution has no transaction evidence. Destructive commit state is unknown; review the retained recovery point before further action.';
    }

    const [updated] = await db
      .update(tenantResetRequests)
      .set({
        status: 'failed',
        completedAt: reconciledAt,
        executionTimeMs: Math.max(0, reconciledAt.getTime() - row.startedAt.getTime()),
        failureReason,
        rollbackPossible: true,
        results: {
          ...existingResults,
          reconciliation: {
            version: 1,
            classification,
            reconciledAt: reconciledAt.toISOString(),
            staleAfterMinutes: RESET_IN_PROGRESS_STALE_MINUTES,
            executionAttemptId:
              typeof metadata.executionAttemptId === 'string'
                ? metadata.executionAttemptId
                : null,
            transactionCommittedAt:
              typeof metadata.executionTransactionCommittedAt === 'string'
                ? metadata.executionTransactionCommittedAt
                : null,
          },
          destructivePlanCommitted,
        },
        updatedAt: reconciledAt,
      })
      .where(
        and(
          eq(tenantResetRequests.id, row.id),
          eq(tenantResetRequests.status, 'in_progress'),
          eq(tenantResetRequests.startedAt, row.startedAt),
        ),
      )
      .returning({ id: tenantResetRequests.id });

    if (!updated) continue;
    result.reconciled += 1;
    if (classification === 'interrupted_before_commit') result.interruptedBeforeCommit += 1;
    else if (classification === 'committed_unfinalized') result.committedUnfinalized += 1;
    else result.unknownLegacy += 1;
  }

  return result;
}
