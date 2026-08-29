import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const actionRoute = readFileSync('src/app/api/approvals/[id]/action/route.ts', 'utf8');
const releaseGate = readFileSync('src/lib/trip-release-gate.ts', 'utf8');

function transportReviewApprovalBlock() {
  const start = actionRoute.indexOf(
    "if (stepActionType === 'transport_review' && actionType === 'approved')",
    actionRoute.indexOf('let decisionMetadata'),
  );
  const end = actionRoute.indexOf(
    "\n    if (stepActionType === 'release' && actionType === 'approved')",
    start,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return actionRoute.slice(start, end);
}

describe('Transport Review live operational readiness', () => {
  it('re-runs the canonical release gate before Transport Review can advance', () => {
    const block = transportReviewApprovalBlock();

    expect(block).toContain('evaluateTripReleaseGate({');
    expect(block).toContain('tenantId: session.tenantId');
    expect(block).toContain('requestId: instance.requestId');
    expect(block).toContain("stage: 'release'");
    expect(block).toContain('if (!readinessGate.allowed)');
    expect(block).toContain('blockers: readinessGate.blockers');
    expect(block).toContain('checks: readinessGate.checks');
    expect(block).toContain('driverKind: readinessGate.driverKind');
    expect(block).toContain("status: 409");
  });

  it('inherits current internal-driver validity, class and professional-authorisation checks', () => {
    expect(releaseGate).toContain('checks.driverLicenceValidThroughReturn = licenceValidThrough');
    expect(releaseGate).toContain("code: 'driver_licence_invalid'");
    expect(releaseGate).toContain('namibiaLicenceClassCovers(driverEvidence.licenceClass, trip.requiredLicenceClass)');
    expect(releaseGate).toContain("code: 'driver_licence_class_mismatch'");
    expect(releaseGate).toContain('checks.professionalAuthorisationValid = Boolean(professional)');
    expect(releaseGate).toContain("code: 'professional_authorisation_invalid'");
  });

  it('inherits live vehicle, driver-overlap and blocking-defect checks', () => {
    expect(releaseGate).toContain('checks.scheduleConflictsClear = !vehicleConflict && !driverConflict');
    expect(releaseGate).toContain("code: 'schedule_conflict'");
    expect(releaseGate).toContain("checks.vehicleAvailable = trip.vehicleStatus === 'available'");
    expect(releaseGate).toContain("code: 'vehicle_unavailable'");
    expect(releaseGate).toContain('checks.noBlockingVehicleDefect = !blockingDefect');
    expect(releaseGate).toContain("code: 'blocking_vehicle_defect'");
  });
});
