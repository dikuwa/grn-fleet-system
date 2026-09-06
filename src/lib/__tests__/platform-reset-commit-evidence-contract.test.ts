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
const claim = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/platform-reset-claim.ts'),
  'utf8',
);
const restore = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/platform-restore-service.ts'),
  'utf8',
);

describe('platform operational reset commit evidence', () => {
  it('passes the exact execution claim into the destructive reset service', () => {
    const claimAssignment = route.indexOf('executionClaimId = claim.claimId');
    const execute = route.indexOf('executeVerifiedPlatformOperationalReset({', claimAssignment);
    const passClaim = route.indexOf('executionClaimId,', execute);

    expect(claimAssignment).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(claimAssignment);
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
    const claimId = snapshot.indexOf("'platformResetExecutionClaimId'", firstDelete);
    const marker = snapshot.indexOf("'platformResetExecutionState'", claimId);
    const committed = snapshot.indexOf("'committed'", marker);
    const claimFence = snapshot.indexOf(
      "metadata}->>'platformExecutionClaimId' = ${input.executionClaimId}",
      committed,
    );
    const transactionReturn = snapshot.indexOf('return {\n        counts: snapshot.counts', claimFence);

    expect(transaction).toBeGreaterThan(-1);
    expect(firstDelete).toBeGreaterThan(transaction);
    expect(claimId).toBeGreaterThan(firstDelete);
    expect(marker).toBeGreaterThan(claimId);
    expect(committed).toBeGreaterThan(marker);
    expect(claimFence).toBeGreaterThan(committed);
    expect(transactionReturn).toBeGreaterThan(claimFence);
  });

  it('records the audit event in the destructive transaction after the marker', () => {
    const marker = snapshot.indexOf("'platformResetExecutionState'");
    const committed = snapshot.indexOf("'committed'", marker);
    const audit = snapshot.indexOf('await recordAuditEvent(', committed);
    const txArgument = snapshot.indexOf('        tx,', audit);
    const transactionReturn = snapshot.indexOf('return {\n        counts: snapshot.counts', txArgument);

    expect(marker).toBeGreaterThan(-1);
    expect(committed).toBeGreaterThan(marker);
    expect(audit).toBeGreaterThan(committed);
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

  it('persists a non-expiring reconciliation marker and does not release that claim', () => {
    const catchBlock = route.indexOf('} catch (error) {');
    const pending = route.indexOf('const reconciliationPending =', catchBlock);
    const mark = route.indexOf(
      'markPlatformResetExecutionClaimPendingReconciliation({',
      pending,
    );
    const releaseGuard = route.indexOf(
      'if (!reconciliationPending && executionClaimId && executionBackupId)',
      mark,
    );
    const pendingCode = route.indexOf("code: 'PLATFORM_RESET_RECONCILIATION_PENDING'", releaseGuard);

    expect(catchBlock).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(catchBlock);
    expect(mark).toBeGreaterThan(pending);
    expect(releaseGuard).toBeGreaterThan(mark);
    expect(pendingCode).toBeGreaterThan(releaseGuard);
  });

  it('reconciles every existing claim under advisory and row locks before reuse', () => {
    const acquire = claim.indexOf('export async function acquirePlatformResetExecutionClaim');
    const advisory = claim.indexOf('pg_advisory_xact_lock', acquire);
    const existingClaims = claim.indexOf('const existingClaims = await tx', advisory);
    const existingPredicate = claim.indexOf("platformExecutionClaimId' IS NOT NULL", existingClaims);
    const loop = claim.indexOf('for (const existing of existingClaims)', existingPredicate);
    const reconcile = claim.indexOf('reconcilePlatformResetExecutionClaim(', loop);
    const blocked = claim.indexOf('if (reconciliation.blocked)', reconcile);
    const newClaim = claim.indexOf('const claimId = randomUUID()', blocked);
    const queriedClaims = claim.slice(existingClaims, loop);
    const helper = claim.indexOf('async function reconcilePlatformResetExecutionClaim');
    const rowLock = claim.indexOf('FOR UPDATE', helper);
    const committed = claim.indexOf('committedEvidenceForClaim(', rowLock);
    const clear = claim.indexOf("- 'platformExecutionClaimId'", committed);

    expect(acquire).toBeGreaterThan(-1);
    expect(advisory).toBeGreaterThan(acquire);
    expect(existingClaims).toBeGreaterThan(advisory);
    expect(existingPredicate).toBeGreaterThan(existingClaims);
    expect(loop).toBeGreaterThan(existingPredicate);
    expect(queriedClaims).not.toContain('.limit(1)');
    expect(reconcile).toBeGreaterThan(loop);
    expect(blocked).toBeGreaterThan(reconcile);
    expect(newClaim).toBeGreaterThan(blocked);
    expect(helper).toBeGreaterThan(-1);
    expect(rowLock).toBeGreaterThan(helper);
    expect(committed).toBeGreaterThan(rowLock);
    expect(clear).toBeGreaterThan(committed);
  });

  it('treats reconciliation-pending claim state as live regardless of TTL', () => {
    const live = claim.indexOf('export function hasLivePlatformResetExecutionClaim');
    const pending = claim.indexOf('if (pendingReconciliation) return true;', live);
    const ttl = claim.indexOf('PLATFORM_RESET_EXECUTION_CLAIM_TTL_MINUTES', pending);

    expect(live).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(live);
    expect(ttl).toBeGreaterThan(pending);
  });

  it('resolves durable committed retries before archive or object-storage I/O', () => {
    const execute = snapshot.indexOf('export async function executeVerifiedPlatformOperationalReset');
    const dbFirst = snapshot.indexOf('readCommittedPlatformResetEvidence({', execute);
    const completed = snapshot.indexOf('if (committedEvidence)', dbFirst);
    const archiveRead = snapshot.indexOf('readPlatformOperationalBackup(input.backupId)', completed);
    const helper = snapshot.indexOf('async function readCommittedPlatformResetEvidence');
    const planMatch = snapshot.indexOf('planFingerprint === input.expectedFingerprint', helper);
    const snapshotMatch = snapshot.indexOf(
      'executionSnapshotFingerprint === verifiedSnapshotFingerprint',
      planMatch,
    );
    const failClosed = snapshot.indexOf('Manual reconciliation is required before retrying.', snapshotMatch);

    expect(execute).toBeGreaterThan(-1);
    expect(dbFirst).toBeGreaterThan(execute);
    expect(completed).toBeGreaterThan(dbFirst);
    expect(archiveRead).toBeGreaterThan(completed);
    expect(helper).toBeGreaterThan(-1);
    expect(planMatch).toBeGreaterThan(helper);
    expect(snapshotMatch).toBeGreaterThan(planMatch);
    expect(failClosed).toBeGreaterThan(snapshotMatch);
  });

  it('keeps an archive-backed idempotency fallback behind the database-first path', () => {
    const execute = snapshot.indexOf('export async function executeVerifiedPlatformOperationalReset');
    const dbFirst = snapshot.indexOf('readCommittedPlatformResetEvidence({', execute);
    const archiveRead = snapshot.indexOf('readPlatformOperationalBackup(input.backupId)', dbFirst);
    const committed = snapshot.indexOf(
      "backupMetadata.platformResetExecutionState === 'committed'",
      archiveRead,
    );
    const counts = snapshot.indexOf('countsFromExecutionMetadata(backupMetadata)', committed);
    const transaction = snapshot.indexOf('current = await db.transaction', counts);

    expect(dbFirst).toBeGreaterThan(-1);
    expect(archiveRead).toBeGreaterThan(dbFirst);
    expect(committed).toBeGreaterThan(archiveRead);
    expect(counts).toBeGreaterThan(committed);
    expect(transaction).toBeGreaterThan(counts);
  });

  it('invalidates prior committed reset evidence atomically when a recovery point is restored', () => {
    const transaction = restore.indexOf('const restored = await db.transaction(async (tx) =>');
    const restoreRows = restore.indexOf('json_populate_recordset', transaction);
    const mark = restore.indexOf('.update(platformBackups)', restoreRows);
    const metadata = restore.indexOf("metadata: sql`COALESCE(${platformBackups.metadata}", mark);
    const executionVersion = restore.indexOf("- 'platformResetExecutionVersion'", metadata);
    const executionClaim = restore.indexOf("- 'platformResetExecutionClaimId'", executionVersion);
    const executionState = restore.indexOf("- 'platformResetExecutionState'", executionClaim);
    const committedAt = restore.indexOf("- 'platformResetExecutionCommittedAt'", executionState);
    const planFingerprint = restore.indexOf("- 'platformResetExecutionPlanFingerprint'", committedAt);
    const snapshotFingerprint = restore.indexOf("- 'platformResetExecutionSnapshotFingerprint'", planFingerprint);
    const counts = restore.indexOf("- 'platformResetExecutionCounts'", snapshotFingerprint);
    const restoredAt = restore.indexOf('restoredAt,', counts);
    const transactionEnd = restore.indexOf('return restoredTables;', restoredAt);
    const mutationWindow = restore.slice(metadata, transactionEnd);

    expect(transaction).toBeGreaterThan(-1);
    expect(restoreRows).toBeGreaterThan(transaction);
    expect(mark).toBeGreaterThan(restoreRows);
    expect(metadata).toBeGreaterThan(mark);
    expect(executionVersion).toBeGreaterThan(metadata);
    expect(executionClaim).toBeGreaterThan(executionVersion);
    expect(executionState).toBeGreaterThan(executionClaim);
    expect(committedAt).toBeGreaterThan(executionState);
    expect(planFingerprint).toBeGreaterThan(committedAt);
    expect(snapshotFingerprint).toBeGreaterThan(planFingerprint);
    expect(counts).toBeGreaterThan(snapshotFingerprint);
    expect(restoredAt).toBeGreaterThan(counts);
    expect(transactionEnd).toBeGreaterThan(restoredAt);
    expect(mutationWindow).not.toContain("- 'platformSnapshotFingerprint'");
  });
});
