import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const guardSource = readFileSync(resolve(process.cwd(), 'src/lib/reset-execution-guard.ts'), 'utf8');
const backupRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/[id]/backup/route.ts'),
  'utf8',
);

describe('reset recovery-point claim contract', () => {
  it('blocks execution while a live recovery-point claim exists', () => {
    const execution = guardSource.indexOf('export async function acquireResetExecutionClaim');
    const recoveryCheck = guardSource.indexOf("'recoveryPointClaimId'", execution);
    const executionWrite = guardSource.indexOf('.update(tenantResetRequests)', recoveryCheck);

    expect(execution).toBeGreaterThan(-1);
    expect(recoveryCheck).toBeGreaterThan(execution);
    expect(executionWrite).toBeGreaterThan(recoveryCheck);
  });

  it('acquires the recovery claim against the exact approved revision', () => {
    const acquire = guardSource.indexOf('export async function acquireResetRecoveryPointClaim');
    const status = guardSource.indexOf("eq(tenantResetRequests.status, 'approved' as const)", acquire);
    const revision = guardSource.indexOf(
      'eq(tenantResetRequests.updatedAt, input.expectedUpdatedAt)',
      status,
    );
    const executionClaimGate = guardSource.indexOf("metadata}->>'executionClaimId'", revision);
    const recoveryClaimGate = guardSource.indexOf("metadata}->>'recoveryPointClaimId'", executionClaimGate);

    expect(acquire).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(acquire);
    expect(revision).toBeGreaterThan(status);
    expect(executionClaimGate).toBeGreaterThan(revision);
    expect(recoveryClaimGate).toBeGreaterThan(executionClaimGate);
  });

  it('keeps the claim through backup creation and post-upload verification', () => {
    const acquire = backupRouteSource.indexOf('acquireResetRecoveryPointClaim({');
    const backup = backupRouteSource.indexOf('createTenantOperationalBackup({', acquire);
    const verification = backupRouteSource.indexOf("metadata}->>'recoveryPointClaimId'", backup);
    const audit = backupRouteSource.indexOf('recordAuditEvent({', verification);
    const release = backupRouteSource.indexOf('releaseResetRecoveryPointClaim({', audit);

    expect(acquire).toBeGreaterThan(-1);
    expect(backup).toBeGreaterThan(acquire);
    expect(verification).toBeGreaterThan(backup);
    expect(audit).toBeGreaterThan(verification);
    expect(release).toBeGreaterThan(audit);
  });

  it('releases the claim before returning a verification conflict', () => {
    const mismatch = backupRouteSource.indexOf('Recovery point verification failed');
    const releaseBeforeConflict = backupRouteSource.lastIndexOf(
      'releaseResetRecoveryPointClaim({',
      mismatch,
    );
    const conflict = backupRouteSource.indexOf('{ status: 409 }', releaseBeforeConflict);

    expect(mismatch).toBeGreaterThan(-1);
    expect(releaseBeforeConflict).toBeGreaterThan(-1);
    expect(releaseBeforeConflict).toBeLessThan(mismatch);
    expect(conflict).toBeGreaterThan(mismatch);
  });
});
