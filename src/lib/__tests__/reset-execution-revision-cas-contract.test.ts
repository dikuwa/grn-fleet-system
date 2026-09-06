import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/reset-service-core.ts'),
  'utf8',
);

describe('reset execution revision compare-and-set', () => {
  it('claims the exact approved revision before clearing prior execution steps', () => {
    const executor = source.indexOf('export async function executeApprovedTenantOperationalReset');
    const transaction = source.indexOf('const executionClaimed = await db.transaction', executor);
    const update = source.indexOf('.update(tenantResetRequests)', transaction);
    const statusClaim = source.indexOf("eq(tenantResetRequests.status, 'approved')", update);
    const revisionClaim = source.indexOf(
      'eq(tenantResetRequests.updatedAt, resetRequest.updatedAt)',
      statusClaim,
    );
    const returning = source.indexOf('.returning({ id: tenantResetRequests.id })', revisionClaim);
    const stepDelete = source.indexOf('tx.delete(resetRequestSteps)', returning);

    expect(executor).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(executor);
    expect(update).toBeGreaterThan(transaction);
    expect(statusClaim).toBeGreaterThan(update);
    expect(revisionClaim).toBeGreaterThan(statusClaim);
    expect(returning).toBeGreaterThan(revisionClaim);
    expect(stepDelete).toBeGreaterThan(returning);
  });

  it('stops execution when the validated revision can no longer be claimed', () => {
    const lostClaim = source.indexOf('if (!executionClaimed)');
    const destructivePlan = source.indexOf('await executeResetPlanAtomically', lostClaim);

    expect(lostClaim).toBeGreaterThan(-1);
    expect(source).toContain('This reset request changed after execution validation.');
    expect(destructivePlan).toBeGreaterThan(lostClaim);
  });
});
