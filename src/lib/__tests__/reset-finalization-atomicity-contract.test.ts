import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/reset-service-core.ts'),
  'utf8',
);

describe('reset execution finalization atomicity', () => {
  it('writes step evidence and final request state in one transaction', () => {
    const integrity = source.indexOf('const integrity = await runIntegrityChecks');
    const transaction = source.indexOf('await db.transaction(async (tx) => {', integrity);
    const stepInsert = source.indexOf('await tx.insert(resetRequestSteps)', transaction);
    const requestUpdate = source.indexOf('.update(tenantResetRequests)', stepInsert);
    const inProgressGuard = source.indexOf(
      "eq(tenantResetRequests.status, 'in_progress')",
      requestUpdate,
    );
    const finalizationFailure = source.indexOf(
      "throw new Error('Reset finalization lost the in-progress request state.')",
      inProgressGuard,
    );

    expect(integrity).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(integrity);
    expect(stepInsert).toBeGreaterThan(transaction);
    expect(requestUpdate).toBeGreaterThan(stepInsert);
    expect(inProgressGuard).toBeGreaterThan(requestUpdate);
    expect(finalizationFailure).toBeGreaterThan(inProgressGuard);
  });

  it('falls back to a single failed-state marker when finalization persistence fails', () => {
    const finalizationFailure = source.indexOf(
      "throw new Error('Reset finalization lost the in-progress request state.')",
    );
    const catchBlock = source.indexOf('} catch (error) {', finalizationFailure);
    const finalizationError = source.indexOf('const finalizationError =', catchBlock);
    const fallbackUpdate = source.indexOf('.update(tenantResetRequests)', finalizationError);
    const failedState = source.indexOf("status: 'failed'", fallbackUpdate);
    const committedMarker = source.indexOf('destructivePlanCommitted: !failed', failedState);
    const inProgressGuard = source.indexOf(
      "eq(tenantResetRequests.status, 'in_progress')",
      committedMarker,
    );
    const lostFallback = source.indexOf('if (!markedFailed) throw error', inProgressGuard);

    expect(catchBlock).toBeGreaterThan(finalizationFailure);
    expect(finalizationError).toBeGreaterThan(catchBlock);
    expect(fallbackUpdate).toBeGreaterThan(finalizationError);
    expect(failedState).toBeGreaterThan(fallbackUpdate);
    expect(committedMarker).toBeGreaterThan(failedState);
    expect(inProgressGuard).toBeGreaterThan(committedMarker);
    expect(lostFallback).toBeGreaterThan(inProgressGuard);
  });
});
