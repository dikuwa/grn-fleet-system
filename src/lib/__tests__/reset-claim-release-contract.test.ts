import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/reset-execution-guard.ts'),
  'utf8',
);

describe('reset claim lease and release hardening', () => {
  it('clamps recovery claims above the maximum five-minute backup route window', () => {
    const minimum = source.indexOf('const MIN_RECOVERY_CLAIM_TTL_MINUTES = 6');
    const exported = source.indexOf('export const RESET_RECOVERY_CLAIM_TTL_MINUTES = Math.max');
    const minimumUse = source.indexOf('MIN_RECOVERY_CLAIM_TTL_MINUTES', exported);

    expect(minimum).toBeGreaterThan(-1);
    expect(exported).toBeGreaterThan(minimum);
    expect(minimumUse).toBeGreaterThan(exported);
  });

  it('releases recovery claims without read-modify-writing an older metadata object', () => {
    const release = source.indexOf('export async function releaseResetRecoveryPointClaim');
    const update = source.indexOf('.update(tenantResetRequests)', release);
    const jsonRemoval = source.indexOf("- 'recoveryPointClaimId'", update);
    const claimFence = source.indexOf("metadata}->>'recoveryPointClaimId'", jsonRemoval);

    expect(release).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(release);
    expect(jsonRemoval).toBeGreaterThan(update);
    expect(claimFence).toBeGreaterThan(jsonRemoval);
  });

  it('releases execution claims with the same atomic metadata preservation rule', () => {
    const release = source.indexOf('export async function releaseResetExecutionClaim');
    const update = source.indexOf('.update(tenantResetRequests)', release);
    const jsonRemoval = source.indexOf("- 'executionClaimId'", update);
    const claimFence = source.indexOf("metadata}->>'executionClaimId'", jsonRemoval);

    expect(release).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(release);
    expect(jsonRemoval).toBeGreaterThan(update);
    expect(claimFence).toBeGreaterThan(jsonRemoval);
  });
});
