import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const externalIssueRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/external-issue/route.ts'),
  'utf8',
);
const releaseGateRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/release-gate/route.ts'),
  'utf8',
);

describe('trip release wrapper UUID guards', () => {
  it('keeps external issue authorization before the malformed-id guard and DB lookup after it', () => {
    const permissionIndex = externalIssueRoute.indexOf('const permissionCheck = await requirePermission');
    const guardIndex = externalIssueRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = externalIssueRoute.indexOf('const [trip] = await getDb()');
    const gateIndex = externalIssueRoute.indexOf('const issueGate = await evaluateTripReleaseGate');
    const delegateIndex = externalIssueRoute.indexOf('return issueExternalVehicleCore');

    expect(externalIssueRoute).toContain('const UUID_PATTERN =');
    expect(externalIssueRoute).toContain("{ error: 'Trip ID is invalid' }");
    expect(permissionIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(gateIndex).toBeGreaterThan(dbIndex);
    expect(delegateIndex).toBeGreaterThan(gateIndex);
  });

  it('keeps release-gate authorization before the malformed-id guard and evaluation after it', () => {
    const roleIndex = releaseGateRoute.indexOf("requireDashboardAction(session, '/dashboard/trips', 'view')");
    const permissionIndex = releaseGateRoute.indexOf('if (!permitted)');
    const guardIndex = releaseGateRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = releaseGateRoute.indexOf('const db = getDb()');
    const gateIndex = releaseGateRoute.indexOf('const result = await evaluateTripReleaseGate');

    expect(releaseGateRoute).toContain('const UUID_PATTERN =');
    expect(releaseGateRoute).toContain("{ error: 'Trip ID is invalid' }");
    expect(roleIndex).toBeGreaterThan(-1);
    expect(permissionIndex).toBeGreaterThan(roleIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(gateIndex).toBeGreaterThan(dbIndex);
  });
});
