import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const issueRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/issue/route.ts'),
  'utf8',
);

describe('trip physical issue UUID guard contract', () => {
  it('rejects malformed trip ids after permission checks and before database access', () => {
    expect(issueRoute).toContain('const UUID_PATTERN =');
    expect(issueRoute).toContain('if (!UUID_PATTERN.test(id))');
    expect(issueRoute).toContain("{ error: 'Trip ID is invalid' }");
    expect(issueRoute).toContain('{ status: 400 }');

    const permissionIndex = issueRoute.indexOf('const permissionCheck = await requirePermission');
    const guardIndex = issueRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = issueRoute.indexOf('const [trip] = await getDb()');

    expect(permissionIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps release-gate evaluation and core mutation delegation behind the guard', () => {
    const guardIndex = issueRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const gateIndex = issueRoute.indexOf('const issueGate = await evaluateTripReleaseGate');
    const coreIndex = issueRoute.indexOf('return issueVehicleCore');

    expect(gateIndex).toBeGreaterThan(guardIndex);
    expect(coreIndex).toBeGreaterThan(gateIndex);
  });
});
