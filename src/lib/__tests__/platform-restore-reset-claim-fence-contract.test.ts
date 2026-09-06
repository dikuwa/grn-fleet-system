import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const restore = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/platform-restore-service.ts'),
  'utf8',
);

describe('platform restore reset-claim fence', () => {
  it('holds the global reset-claim advisory lock while checking claims and restoring rows', () => {
    const transaction = restore.indexOf('const restored = await db.transaction(async (tx) =>');
    const claimLock = restore.indexOf(
      "pg_advisory_xact_lock(hashtext('govfleet-platform-operational-reset-claim'))",
      transaction,
    );
    const claimQuery = restore.indexOf('const [resetClaim] = await tx', claimLock);
    const claimPredicate = restore.indexOf("platformExecutionClaimId' IS NOT NULL", claimQuery);
    const claimBlock = restore.indexOf('if (resetClaim)', claimPredicate);
    const restoreLock = restore.indexOf(
      "pg_advisory_xact_lock(hashtext('govfleet-platform-operational-restore'))",
      claimBlock,
    );
    const restoreRows = restore.indexOf('json_populate_recordset', restoreLock);
    const evidenceInvalidation = restore.indexOf("- 'platformResetExecutionState'", restoreRows);
    const transactionEnd = restore.indexOf('return restoredTables;', evidenceInvalidation);

    expect(transaction).toBeGreaterThan(-1);
    expect(claimLock).toBeGreaterThan(transaction);
    expect(claimQuery).toBeGreaterThan(claimLock);
    expect(claimPredicate).toBeGreaterThan(claimQuery);
    expect(claimBlock).toBeGreaterThan(claimPredicate);
    expect(restoreLock).toBeGreaterThan(claimBlock);
    expect(restoreRows).toBeGreaterThan(restoreLock);
    expect(evidenceInvalidation).toBeGreaterThan(restoreRows);
    expect(transactionEnd).toBeGreaterThan(evidenceInvalidation);
  });

  it('fails closed instead of restoring while any platform reset claim is present', () => {
    const claimQuery = restore.indexOf('const [resetClaim] = await tx');
    const scope = restore.indexOf("eq(platformBackups.scope, 'platform_operational')", claimQuery);
    const anyClaim = restore.indexOf("platformExecutionClaimId' IS NOT NULL", scope);
    const guard = restore.indexOf('if (resetClaim)', anyClaim);
    const error = restore.indexOf('Restore blocked while a platform operational reset is active', guard);
    const restoreRows = restore.indexOf('json_populate_recordset', error);

    expect(claimQuery).toBeGreaterThan(-1);
    expect(scope).toBeGreaterThan(claimQuery);
    expect(anyClaim).toBeGreaterThan(scope);
    expect(guard).toBeGreaterThan(anyClaim);
    expect(error).toBeGreaterThan(guard);
    expect(restoreRows).toBeGreaterThan(error);
  });
});
