import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const claim = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/platform-reset-claim.ts'),
  'utf8',
);
const backupRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/backups/[id]/route.ts'),
  'utf8',
);

describe('platform reset recovery-point release protection', () => {
  it('uses the same advisory lock for execution claims, protection changes, and deletion reservation', () => {
    const lockName = claim.indexOf("const PLATFORM_RESET_CLAIM_LOCK = 'govfleet-platform-operational-reset-claim'");
    const protection = claim.indexOf('export async function setBackupProtectionWithPlatformResetFence');
    const protectionLock = claim.indexOf('pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))', protection);
    const deletion = claim.indexOf('export async function deleteBackupWithPlatformResetFence');
    const deletionLock = claim.indexOf('pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))', deletion);
    const acquire = claim.indexOf('export async function acquirePlatformResetExecutionClaim');
    const acquireLock = claim.indexOf('pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))', acquire);

    expect(lockName).toBeGreaterThan(-1);
    expect(protection).toBeGreaterThan(lockName);
    expect(protectionLock).toBeGreaterThan(protection);
    expect(deletion).toBeGreaterThan(protectionLock);
    expect(deletionLock).toBeGreaterThan(deletion);
    expect(acquire).toBeGreaterThan(deletionLock);
    expect(acquireLock).toBeGreaterThan(acquire);
  });

  it('preserves the existing recovery-point policy and live claim before unprotecting', () => {
    const protection = claim.indexOf('export async function setBackupProtectionWithPlatformResetFence');
    const deletingGuard = claim.indexOf("if (backup.status === 'deleting')", protection);
    const policy = claim.indexOf('recoveryPointReleaseBlockReason({', deletingGuard);
    const policyFailure = claim.indexOf('if (policyBlockReason) throw new Error(policyBlockReason)', policy);
    const liveClaim = claim.indexOf('hasLivePlatformResetExecutionClaim(backup.metadata)', policyFailure);
    const update = claim.indexOf('.update(platformBackups)', liveClaim);
    const setProtection = claim.indexOf('.set({ isProtected, updatedAt: new Date() })', update);

    expect(protection).toBeGreaterThan(-1);
    expect(deletingGuard).toBeGreaterThan(protection);
    expect(policy).toBeGreaterThan(deletingGuard);
    expect(policyFailure).toBeGreaterThan(policy);
    expect(liveClaim).toBeGreaterThan(policyFailure);
    expect(update).toBeGreaterThan(liveClaim);
    expect(setProtection).toBeGreaterThan(update);
  });

  it('checks the linked reset status while evaluating recovery-point release policy', () => {
    const protection = claim.indexOf('export async function setBackupProtectionWithPlatformResetFence');
    const resetLookup = claim.indexOf('.from(tenantResetRequests)', protection);
    const policy = claim.indexOf('recoveryPointReleaseBlockReason({', resetLookup);
    const resetStatus = claim.indexOf('resetStatus: resetRequest?.status ?? null', policy);

    expect(resetLookup).toBeGreaterThan(protection);
    expect(policy).toBeGreaterThan(resetLookup);
    expect(resetStatus).toBeGreaterThan(policy);
  });

  it('reserves deletion before durable storage removal and fails closed on storage errors', () => {
    const deletion = claim.indexOf('export async function deleteBackupWithPlatformResetFence');
    const lock = claim.indexOf('pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))', deletion);
    const policy = claim.indexOf("action: 'delete'", lock);
    const liveClaim = claim.indexOf('hasLivePlatformResetExecutionClaim(current.metadata)', policy);
    const reserve = claim.indexOf("status: 'deleting'", liveClaim);
    const leaseId = claim.indexOf("'backupDeletionClaimId'", reserve);
    const storageDelete = claim.indexOf('await deleteFile(backup.storageKey)', leaseId);
    const failedClosed = claim.indexOf("status: 'failed'", storageDelete);
    const failureClaimFence = claim.indexOf("backupDeletionClaimId' = ${deletionClaimId}", failedClosed);
    const finalizeDeleted = claim.indexOf("status: 'deleted'", failureClaimFence);
    const finalClaimFence = claim.indexOf("backupDeletionClaimId' = ${deletionClaimId}", finalizeDeleted);

    expect(deletion).toBeGreaterThan(-1);
    expect(lock).toBeGreaterThan(deletion);
    expect(policy).toBeGreaterThan(lock);
    expect(liveClaim).toBeGreaterThan(policy);
    expect(reserve).toBeGreaterThan(liveClaim);
    expect(leaseId).toBeGreaterThan(reserve);
    expect(storageDelete).toBeGreaterThan(leaseId);
    expect(failedClosed).toBeGreaterThan(storageDelete);
    expect(failureClaimFence).toBeGreaterThan(failedClosed);
    expect(finalizeDeleted).toBeGreaterThan(failureClaimFence);
    expect(finalClaimFence).toBeGreaterThan(finalizeDeleted);
  });

  it('reclaims stale deletion reservations while rejecting a live deletion lease', () => {
    const ttl = claim.indexOf('BACKUP_DELETION_CLAIM_TTL_MINUTES');
    const liveHelper = claim.indexOf('export function hasLiveBackupDeletionClaim');
    const deletion = claim.indexOf('export async function deleteBackupWithPlatformResetFence');
    const reclaimFlag = claim.indexOf("const reclaimingStaleDeletion = current.status === 'deleting'", deletion);
    const liveGuard = claim.indexOf('hasLiveBackupDeletionClaim(current.metadata, now)', reclaimFlag);
    const staleBefore = claim.indexOf('const staleDeletionBefore = new Date(', liveGuard);
    const missingLease = claim.indexOf("backupDeletionClaimId' IS NULL", staleBefore);
    const staleLease = claim.indexOf("backupDeletionClaimedAt', '')::timestamptz < ${staleDeletionBefore}", missingLease);

    expect(ttl).toBeGreaterThan(-1);
    expect(liveHelper).toBeGreaterThan(ttl);
    expect(reclaimFlag).toBeGreaterThan(deletion);
    expect(liveGuard).toBeGreaterThan(reclaimFlag);
    expect(staleBefore).toBeGreaterThan(liveGuard);
    expect(missingLease).toBeGreaterThan(staleBefore);
    expect(staleLease).toBeGreaterThan(missingLease);
  });

  it('requires the selected platform recovery point to remain protected while claiming execution', () => {
    const target = claim.indexOf('const [target] = await tx');
    const targetProtected = claim.indexOf('eq(platformBackups.isProtected, true)', target);
    const update = claim.indexOf('.update(platformBackups)', targetProtected);
    const updateProtected = claim.indexOf('eq(platformBackups.isProtected, true)', update);

    expect(target).toBeGreaterThan(-1);
    expect(targetProtected).toBeGreaterThan(target);
    expect(update).toBeGreaterThan(targetProtected);
    expect(updateProtected).toBeGreaterThan(update);
  });

  it('keeps live global claims visible regardless of backup status', () => {
    const active = claim.indexOf("platformExecutionClaimId' IS NOT NULL");
    const activeWindow = claim.slice(Math.max(0, active - 500), active + 500);

    expect(active).toBeGreaterThan(-1);
    expect(activeWindow).not.toContain("eq(platformBackups.status, 'ready')");
  });

  it('routes PATCH and DELETE through their serialized helpers', () => {
    const patch = backupRoute.indexOf('export async function PATCH');
    const fencedProtection = backupRoute.indexOf(
      'await setBackupProtectionWithPlatformResetFence(id, body.isProtected)',
      patch,
    );
    const deleteHandler = backupRoute.indexOf('export async function DELETE', fencedProtection);
    const fencedDelete = backupRoute.indexOf(
      'await deleteBackupWithPlatformResetFence(id)',
      deleteHandler,
    );

    expect(fencedProtection).toBeGreaterThan(patch);
    expect(deleteHandler).toBeGreaterThan(fencedProtection);
    expect(fencedDelete).toBeGreaterThan(deleteHandler);
    expect(backupRoute).not.toContain("import { deleteBackup } from '@/lib/data-protection/backup-service';");
  });
});