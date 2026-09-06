import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const snapshot = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/platform-reset-snapshot.ts'),
  'utf8',
);
const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/platform/route.ts'),
  'utf8',
);

describe('platform operational reset commit evidence', () => {
  it('passes the exact execution claim into the destructive reset service', () => {
    const claim = route.indexOf('executionClaimId = claim.claimId');
    const execute = route.indexOf('executeVerifiedPlatformOperationalReset({', claim);
    const passClaim = route.indexOf('executionClaimId,', execute);

    expect(claim).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(claim);
    expect(passClaim).toBeGreaterThan(execute);
  });

  it('requires the exact live claim before deleting platform rows', () => {
    const currentBackup = snapshot.indexOf('const currentMetadata =');
    const claimFence = snapshot.indexOf(
      'currentMetadata.platformExecutionClaimId !== input.executionClaimId',
      currentBackup,
    );
    const firstDelete = snapshot.indexOf('.delete(notificationDeliveries)', claimFence);

    expect(currentBackup).toBeGreaterThan(-1);
    expect(claimFence).toBeGreaterThan(currentBackup);
    expect(firstDelete).toBeGreaterThan(claimFence);
  });

  it('writes claim-bound committed evidence after deletes inside the same transaction', () => {
    const transaction = snapshot.indexOf('current = await db.transaction(async (tx) =>');
    const firstDelete = snapshot.indexOf('.delete(notificationDeliveries)', transaction);
    const marker = snapshot.indexOf("'platformResetExecutionState', 'committed'", firstDelete);
    const claimId = snapshot.indexOf("'platformResetExecutionClaimId'", marker);
    const claimFence = snapshot.indexOf(
      "metadata}->>'platformExecutionClaimId' = ${input.executionClaimId}",
      marker,
    );
    const transactionReturn = snapshot.indexOf('return {\n        counts: snapshot.counts', claimFence);

    expect(transaction).toBeGreaterThan(-1);
    expect(firstDelete).toBeGreaterThan(transaction);
    expect(marker).toBeGreaterThan(firstDelete);
    expect(claimId).toBeGreaterThan(marker);
    expect(claimFence).toBeGreaterThan(marker);
    expect(transactionReturn).toBeGreaterThan(claimFence);
  });

  it('records the audit event in the destructive transaction after the marker', () => {
    const marker = snapshot.indexOf("'platformResetExecutionState', 'committed'");
    const audit = snapshot.indexOf('await recordAuditEvent(', marker);
    const txArgument = snapshot.indexOf('        tx,', audit);
    const transactionReturn = snapshot.indexOf('return {\n        counts: snapshot.counts', txArgument);

    expect(marker).toBeGreaterThan(-1);
    expect(audit).toBeGreaterThan(marker);
    expect(txArgument).toBeGreaterThan(audit);
    expect(transactionReturn).toBeGreaterThan(txArgument);
  });

  it('waits for an ambiguous transaction to settle before classifying evidence', () => {
    const resolver = snapshot.indexOf('async function resolveCommittedPlatformResetAfterError');
    const lock = snapshot.indexOf('FOR UPDATE', resolver);
    const exactClaim = snapshot.indexOf(
      'metadata.platformResetExecutionClaimId === input.executionClaimId',
      lock,
    );
    const committed = snapshot.indexOf("metadata.platformResetExecutionState === 'committed'", exactClaim);

    expect(resolver).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(resolver);
    expect(exactClaim).toBeGreaterThan(lock);
    expect(committed).toBeGreaterThan(exactClaim);
  });

  it('reconstructs a committed result after a lost transaction response', () => {
    const catchBlock = snapshot.indexOf('} catch (error) {', snapshot.indexOf('current = await db.transaction'));
    const resolver = snapshot.indexOf('resolveCommittedPlatformResetAfterError({', catchBlock);
    const committed = snapshot.indexOf('if (resolved.committed)', resolver);
    const restoreResult = snapshot.indexOf('counts: resolved.counts', committed);

    expect(catchBlock).toBeGreaterThan(-1);
    expect(resolver).toBeGreaterThan(catchBlock);
    expect(committed).toBeGreaterThan(resolver);
    expect(restoreResult).toBeGreaterThan(committed);
  });

  it('keeps the global execution claim while commit reconciliation is pending', () => {
    const catchBlock = route.indexOf('} catch (error) {');
    const pending = route.indexOf('const reconciliationPending =', catchBlock);
    const releaseGuard = route.indexOf(
      'if (!reconciliationPending && executionClaimId && executionBackupId)',
      pending,
    );
    const pendingCode = route.indexOf("code: 'PLATFORM_RESET_RECONCILIATION_PENDING'", releaseGuard);

    expect(catchBlock).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(catchBlock);
    expect(releaseGuard).toBeGreaterThan(pending);
    expect(pendingCode).toBeGreaterThan(releaseGuard);
  });

  it('supports idempotent retries after a durable committed marker', () => {
    const committed = snapshot.indexOf(
      "backupMetadata.platformResetExecutionState === 'committed'",
    );
    const counts = snapshot.indexOf('countsFromExecutionMetadata(backupMetadata)', committed);
    const transaction = snapshot.indexOf('current = await db.transaction', counts);

    expect(committed).toBeGreaterThan(-1);
    expect(counts).toBeGreaterThan(committed);
    expect(transaction).toBeGreaterThan(counts);
  });
});
