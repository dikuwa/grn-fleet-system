import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/fuel/receipts/register/route.ts'),
  'utf8',
);

describe('fuel receipt register UUID filters', () => {
  it('keeps authentication and Transport Office access checks before filter validation', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
    const accessIndex = source.indexOf('if (!canManage && !canVerify)');
    const paramsIndex = source.indexOf('const { searchParams } = new URL(request.url)');
    const vehicleGuardIndex = source.indexOf('if (vehicleId && !UUID_PATTERN.test(vehicleId))');
    const conditionsIndex = source.indexOf('const conditions =', vehicleGuardIndex);
    const dbIndex = source.indexOf('const db = getDb();', conditionsIndex);

    expect(source).toContain('const UUID_PATTERN =');
    expect(accessIndex).toBeGreaterThan(authIndex);
    expect(paramsIndex).toBeGreaterThan(accessIndex);
    expect(vehicleGuardIndex).toBeGreaterThan(paramsIndex);
    expect(conditionsIndex).toBeGreaterThan(vehicleGuardIndex);
    expect(dbIndex).toBeGreaterThan(conditionsIndex);
  });

  it('rejects malformed vehicle and driver filters as client errors before UUID-backed conditions', () => {
    const vehicleGuardIndex = source.indexOf('if (vehicleId && !UUID_PATTERN.test(vehicleId))');
    const driverGuardIndex = source.indexOf('if (driverEmployeeId && !UUID_PATTERN.test(driverEmployeeId))');
    const conditionsIndex = source.indexOf('const conditions =', vehicleGuardIndex);
    const guardBlock = source.slice(vehicleGuardIndex, conditionsIndex);

    expect(driverGuardIndex).toBeGreaterThan(vehicleGuardIndex);
    expect(guardBlock).toContain("{ error: 'Vehicle filter is invalid' }");
    expect(guardBlock).toContain("{ error: 'Driver filter is invalid' }");
    expect(guardBlock.match(/\{ status: 400 \}/g)).toHaveLength(2);
  });
});
