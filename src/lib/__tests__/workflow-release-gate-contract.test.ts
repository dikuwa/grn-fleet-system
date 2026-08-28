import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const actionRouteSource = readFileSync(
  resolve(root, 'src/app/api/approvals/[id]/action/route.ts'),
  'utf8',
);
const releaseGateSource = readFileSync(resolve(root, 'src/lib/trip-release-gate.ts'), 'utf8');

describe('workflow release readiness gate contract', () => {
  it('supports release as a first-class operational gate stage', () => {
    expect(releaseGateSource).toContain(
      "export type TripReleaseGateStage = 'release' | 'authorisation' | 'issue';",
    );
    expect(releaseGateSource).toContain('checks.allocationConfirmed');
    expect(releaseGateSource).toContain('checks.scheduleConflictsClear');
    expect(releaseGateSource).toContain('checks.driverLicenceValidThroughReturn');
    expect(releaseGateSource).toContain('checks.driverLicenceClassCoversVehicle');
    expect(releaseGateSource).toContain('checks.noBlockingVehicleDefect');
  });

  it('runs the canonical operational gate before a positive release workflow decision', () => {
    expect(actionRouteSource).toContain("stepActionType === 'release' && actionType === 'approved'");
    expect(actionRouteSource).toContain("stage: 'release'");
    expect(actionRouteSource).toContain('Release is blocked by operational readiness requirements.');
    expect(actionRouteSource).toContain('blockers: releaseGate.blockers');
    expect(actionRouteSource).toContain('checks: releaseGate.checks');
  });

  it('keeps final authorisation on its stricter authorisation-stage gate', () => {
    expect(actionRouteSource).toContain("stepActionType === 'authorise' && actionType === 'approved'");
    expect(actionRouteSource).toContain("stage: 'authorisation'");
    expect(releaseGateSource).toContain("if (input.stage === 'authorisation')");
  });
});
