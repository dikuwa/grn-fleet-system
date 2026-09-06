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
  it('uses the same advisory lock for execution claims and backup protection changes', () => {
    const lockName = claim.indexOf("const PLATFORM_RESET_CLAIM_LOCK = 'govfleet-platform-operational-reset-claim'");
    const protection = claim.indexOf('export async function setBackupProtectionWithPlatformResetFence');
    const protectionLock = claim.indexOf('pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))', protection);
    const acquire = claim.indexOf('export async function acquirePlatformResetExecutionClaim');
    const acquireLock = claim.indexOf('pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))', acquire);

    expect(lockName).toBeGreaterThan(-1);
    expect(protection).toBeGreaterThan(lockName);
    expect(protectionLock).toBeGreaterThan(protection);
    expect(acquire).toBeGreaterThan(protectionLock);
    expect(acquireLock).toBeGreaterThan(acquire);
  });

  it('checks the live claim before unprotecting inside the serialized transaction', () => {
    const protection = claim.indexOf('export async function setBackupProtectionWithPlatformResetFence');
    const liveClaim = claim.indexOf('hasLivePlatformResetExecutionClaim(backup.metadata)', protection);
    const update = claim.indexOf('.update(platformBackups)', liveClaim);
    const setProtection = claim.indexOf('.set({ isProtected, updatedAt: new Date() })', update);

    expect(protection).toBeGreaterThan(-1);
    expect(liveClaim).toBeGreaterThan(protection);
    expect(update).toBeGreaterThan(liveClaim);
    expect(setProtection).toBeGreaterThan(update);
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

  it('routes PATCH through the serialized protection helper and guards delete before removal', () => {
    const patch = backupRoute.indexOf('export async function PATCH');
    const fencedProtection = backupRoute.indexOf(
      'await setBackupProtectionWithPlatformResetFence(id, body.isProtected)',
      patch,
    );
    const deleteHandler = backupRoute.indexOf('export async function DELETE', fencedProtection);
    const deleteGuard = backupRoute.indexOf(
      'await assertNoActivePlatformResetExecutionClaim(id)',
      deleteHandler,
    );
    const remove = backupRoute.indexOf('await deleteBackup(id)', deleteGuard);

    expect(fencedProtection).toBeGreaterThan(patch);
    expect(deleteGuard).toBeGreaterThan(deleteHandler);
    expect(remove).toBeGreaterThan(deleteGuard);
  });
});
