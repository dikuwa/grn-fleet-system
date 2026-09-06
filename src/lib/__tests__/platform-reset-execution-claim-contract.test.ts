import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const claim = readFileSync(
  resolve(process.cwd(), 'src/lib/data-protection/platform-reset-claim.ts'),
  'utf8',
);
const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/platform/route.ts'),
  'utf8',
);

describe('platform reset execution claim', () => {
  it('serializes global claim acquisition before writing the selected backup claim', () => {
    const transaction = claim.indexOf('return db.transaction(async (tx) => {');
    const advisory = claim.indexOf('pg_advisory_xact_lock', transaction);
    const activeClaim = claim.indexOf("platformExecutionClaimId' IS NOT NULL", advisory);
    const claimUpdate = claim.indexOf('.update(platformBackups)', activeClaim);
    const claimFence = claim.indexOf("platformExecutionClaimId' IS NULL", claimUpdate);

    expect(transaction).toBeGreaterThan(-1);
    expect(advisory).toBeGreaterThan(transaction);
    expect(activeClaim).toBeGreaterThan(advisory);
    expect(claimUpdate).toBeGreaterThan(activeClaim);
    expect(claimFence).toBeGreaterThan(claimUpdate);
  });

  it('keeps a live global claim visible even if the claimed backup leaves ready state', () => {
    const activeSelect = claim.indexOf("platformExecutionClaimId' IS NOT NULL");
    const activeWindow = claim.slice(Math.max(0, activeSelect - 500), activeSelect + 500);
    const targetSelect = claim.indexOf('const [target] = await tx');
    const targetReady = claim.indexOf("eq(platformBackups.status, 'ready')", targetSelect);

    expect(activeSelect).toBeGreaterThan(-1);
    expect(activeWindow).not.toContain("eq(platformBackups.status, 'ready')");
    expect(targetReady).toBeGreaterThan(targetSelect);
  });

  it('clamps the platform execution lease above the five-minute route window', () => {
    expect(claim).toContain('const MIN_PLATFORM_RESET_CLAIM_TTL_MINUTES = 6');
    expect(claim).toContain('Math.max(\n  MIN_PLATFORM_RESET_CLAIM_TTL_MINUTES');
  });

  it('acquires before destructive execution and releases on both success and failure', () => {
    const acquire = route.indexOf('await acquirePlatformResetExecutionClaim({');
    const execute = route.indexOf('await executePlatformOperationalReset({', acquire);
    const successRelease = route.indexOf('await releasePlatformResetExecutionClaim({', execute);
    const catchBlock = route.indexOf('} catch (error) {', successRelease);
    const failureRelease = route.indexOf('await releasePlatformResetExecutionClaim({', catchBlock);

    expect(acquire).toBeGreaterThan(-1);
    expect(execute).toBeGreaterThan(acquire);
    expect(successRelease).toBeGreaterThan(execute);
    expect(catchBlock).toBeGreaterThan(successRelease);
    expect(failureRelease).toBeGreaterThan(catchBlock);
  });
});
