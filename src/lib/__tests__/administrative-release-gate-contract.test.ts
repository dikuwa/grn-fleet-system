import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const gateSource = readFileSync(
  new URL('../administrative-release-gate.ts', import.meta.url),
  'utf8',
);
const decisionSource = readFileSync(
  new URL('../workflow-decision-atomic.ts', import.meta.url),
  'utf8',
);
const builderSource = readFileSync(new URL('../workflow-builder.ts', import.meta.url), 'utf8');

describe('Administrative Release operational readiness contract', () => {
  it('reuses the canonical trip safety gate without importing issue-stage requirements', () => {
    expect(gateSource).toContain('evaluateTripReleaseGate');
    expect(gateSource).toContain("stage: 'release' as TripReleaseGateStage");
    expect(gateSource).not.toContain("stage: 'issue'");
    expect(gateSource).not.toContain('driverAcknowledged');
    expect(gateSource).not.toContain('departureInspection');
    expect(gateSource).not.toContain('authorityDocumentCurrent');
  });

  it('requires all configured stages before release and specifically Transport Review', () => {
    expect(gateSource).toContain("const releaseStep = resolvedSteps.find((step) => step.actionType === 'release')");
    expect(gateSource).toContain('step.stepOrder < releaseStep.stepOrder');
    expect(gateSource).toContain('priorSteps.every((step) => completedStepOrders.has(step.stepOrder))');
    expect(gateSource).toContain("priorSteps.find((step) => step.actionType === 'transport_review')");
    expect(gateSource).toContain("code: 'transport_review_incomplete'");
  });

  it('keeps configured Release in the governed order after Transport Review and before Final Authorisation', () => {
    expect(builderSource).toContain(
      '(releaseIndex >= 0 && (releaseIndex <= transportIndex || releaseIndex >= authoriseIndex))',
    );
  });

  it('enforces readiness before the unchanged atomic release transition', () => {
    const gateIndex = decisionSource.indexOf('evaluateAdministrativeReleaseGate');
    const coreIndex = decisionSource.lastIndexOf('processAtomicWorkflowDecisionCore(input)');

    expect(decisionSource).toContain("input.action !== 'release' || input.result !== 'released'");
    expect(decisionSource).toContain('currentStep.requiredPermission');
    expect(decisionSource).toContain('currentStep.assignedUserId');
    expect(decisionSource).toContain('selfConflict');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(coreIndex).toBeGreaterThan(gateIndex);
    expect(decisionSource).toContain(
      'Administrative Release is blocked by operational readiness requirements.',
    );
  });
});
