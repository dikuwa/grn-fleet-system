import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const service = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/reset-service-core.ts'),
  'utf8',
);
const reconciliation = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/reset-reconciliation.ts'),
  'utf8',
);

describe('reset execution crash evidence and reconciliation', () => {
  it('records not-started evidence before entering in_progress', () => {
    const attemptId = service.indexOf('const executionAttemptId = randomUUID()');
    const state = service.indexOf("executionTransactionState: 'not_started'", attemptId);
    const claim = service.indexOf("status: 'in_progress'", state);

    expect(attemptId).toBeGreaterThan(-1);
    expect(state).toBeGreaterThan(attemptId);
    expect(claim).toBeGreaterThan(state);
  });

  it('writes committed evidence inside the same atomic mutation group as deletes', () => {
    const atomic = service.indexOf('async function executeResetPlanAtomically');
    const deletes = service.indexOf('executor.delete(resetTable', atomic);
    const committed = service.indexOf("'executionTransactionState', 'committed'", deletes);
    const guard = service.indexOf("metadata}->>'executionTransactionState' = 'not_started'", committed);
    const rollbackFence = service.indexOf('SELECT 1 / COUNT(*)::int FROM evidence', guard);
    const returnMutations = service.indexOf('return mutations;', rollbackFence);

    expect(atomic).toBeGreaterThan(-1);
    expect(deletes).toBeGreaterThan(atomic);
    expect(committed).toBeGreaterThan(deletes);
    expect(guard).toBeGreaterThan(committed);
    expect(rollbackFence).toBeGreaterThan(guard);
    expect(returnMutations).toBeGreaterThan(rollbackFence);
  });

  it('classifies stale executions without guessing legacy commit state', () => {
    expect(reconciliation).toContain("metadata.executionTransactionState === 'not_started'");
    expect(reconciliation).toContain("metadata.executionTransactionState === 'committed'");
    expect(reconciliation).toContain("classification = 'interrupted_before_commit'");
    expect(reconciliation).toContain("classification = 'committed_unfinalized'");
    expect(reconciliation).toContain("classification = 'unknown_legacy'");
    expect(reconciliation).toContain('destructivePlanCommitted = null');
  });

  it('reconciles only stale in-progress rows and fences the exact execution start', () => {
    const staleQuery = reconciliation.indexOf("eq(tenantResetRequests.status, 'in_progress')");
    const cutoff = reconciliation.indexOf('lt(tenantResetRequests.startedAt, staleBefore)', staleQuery);
    const update = reconciliation.indexOf('.update(tenantResetRequests)', cutoff);
    const statusFence = reconciliation.indexOf(
      "eq(tenantResetRequests.status, 'in_progress')",
      update,
    );
    const startFence = reconciliation.indexOf(
      'eq(tenantResetRequests.startedAt, row.startedAt)',
      statusFence,
    );

    expect(staleQuery).toBeGreaterThan(-1);
    expect(cutoff).toBeGreaterThan(staleQuery);
    expect(update).toBeGreaterThan(cutoff);
    expect(statusFence).toBeGreaterThan(update);
    expect(startFence).toBeGreaterThan(statusFence);
  });
});
