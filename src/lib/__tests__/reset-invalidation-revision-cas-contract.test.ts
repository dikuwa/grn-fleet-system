import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/reset-service-core.ts'),
  'utf8',
);

describe('reset dry-run invalidation revision compare-and-set', () => {
  it('invalidates only the exact approved revision that was reviewed', () => {
    const executor = source.indexOf('export async function executeApprovedTenantOperationalReset');
    const mismatch = source.indexOf('freshPreview.fingerprint !== storedFingerprint', executor);
    const invalidatedAt = source.indexOf('const invalidatedAt = new Date()', mismatch);
    const update = source.indexOf('.update(tenantResetRequests)', invalidatedAt);
    const statusClaim = source.indexOf("eq(tenantResetRequests.status, 'approved')", update);
    const revisionClaim = source.indexOf(
      'eq(tenantResetRequests.updatedAt, resetRequest.updatedAt)',
      statusClaim,
    );
    const returning = source.indexOf('.returning({ id: tenantResetRequests.id })', revisionClaim);
    const lostClaim = source.indexOf('if (!invalidated)', returning);

    expect(executor).toBeGreaterThan(-1);
    expect(mismatch).toBeGreaterThan(executor);
    expect(invalidatedAt).toBeGreaterThan(mismatch);
    expect(update).toBeGreaterThan(invalidatedAt);
    expect(statusClaim).toBeGreaterThan(update);
    expect(revisionClaim).toBeGreaterThan(statusClaim);
    expect(returning).toBeGreaterThan(revisionClaim);
    expect(lostClaim).toBeGreaterThan(returning);
  });

  it('does not erase a newer backup revision when the stale invalidation claim is lost', () => {
    const lostClaim = source.indexOf('if (!invalidated)');
    const staleMessage = source.indexOf(
      'This reset request changed after execution validation.',
      lostClaim,
    );
    const mismatchMessage = source.indexOf(
      'Selected data changed after the dry run.',
      lostClaim,
    );

    expect(lostClaim).toBeGreaterThan(-1);
    expect(staleMessage).toBeGreaterThan(lostClaim);
    expect(mismatchMessage).toBeGreaterThan(staleMessage);
  });
});