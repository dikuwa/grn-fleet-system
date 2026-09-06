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

  it('blocks unprotect and delete before changing a recovery point with an active claim', () => {
    const patch = backupRoute.indexOf('export async function PATCH');
    const releaseGuard = backupRoute.indexOf(
      'await assertNoActivePlatformResetExecutionClaim(id)',
      patch,
    );
    const unprotect = backupRoute.indexOf('await setBackupProtection(id, body.isProtected)', releaseGuard);
    const deleteHandler = backupRoute.indexOf('export async function DELETE', unprotect);
    const deleteGuard = backupRoute.indexOf(
      'await assertNoActivePlatformResetExecutionClaim(id)',
      deleteHandler,
    );
    const remove = backupRoute.indexOf('await deleteBackup(id)', deleteGuard);

    expect(releaseGuard).toBeGreaterThan(patch);
    expect(unprotect).toBeGreaterThan(releaseGuard);
    expect(deleteGuard).toBeGreaterThan(deleteHandler);
    expect(remove).toBeGreaterThan(deleteGuard);
  });
});
