import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync(
  resolve(
    process.cwd(),
    'src/app/(dashboard)/dashboard/trips/[id]/incidents/[incidentId]/page.tsx',
  ),
  'utf8',
);
const investigationPanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/incidents/InvestigationPanel.tsx'),
  'utf8',
);
const capabilityRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/capabilities/route.ts'),
  'utf8',
);

describe('legacy incident detail dedicated capability contract', () => {
  it('resolves the dedicated incident sub-action permissions explicitly', () => {
    expect(capabilityRouteSource).toContain('Permissions.INCIDENT_COMPLETE_DETAILS');
    expect(capabilityRouteSource).toContain('Permissions.INCIDENT_INVESTIGATE');
    expect(capabilityRouteSource).toContain('Permissions.INCIDENT_CLOSE_INVESTIGATION');
    expect(capabilityRouteSource).toContain('Permissions.INCIDENT_TECHNICAL_CLEARANCE');
    expect(capabilityRouteSource).toContain('Permissions.INCIDENT_INSURANCE_UPDATE');
    expect(capabilityRouteSource).toContain('Permissions.FILE_VIEW');
  });

  it('fails closed for actions without converting a capability network failure into incident-not-found', () => {
    expect(pageSource).toContain("fetch('/api/incidents/capabilities').catch(() => null)");
    expect(pageSource).toContain('if (capabilityRes?.ok)');
    expect(pageSource).toContain('setCapabilities(EMPTY_CAPABILITIES)');
    expect(pageSource).not.toContain('if (!canManage) return;');
  });

  it('preserves MVA evidence for broad incident managers while keeping mutations capability-gated', () => {
    expect(pageSource).toContain('capabilities.canManage ||');
    expect(pageSource).toContain('showInvestigationEvidence');
    expect(pageSource).toContain('capabilities.canInsuranceUpdate ? (');
    expect(pageSource).toContain(') : capabilities.canManage ? (');
    expect(pageSource).toContain('capabilities.canTechnicalClearance ? (');
  });

  it('makes investigation editing and final closure independent capabilities', () => {
    expect(pageSource).toContain('canInvestigate={capabilities.canInvestigate}');
    expect(pageSource).toContain('canCloseInvestigation={capabilities.canCloseInvestigation}');
    expect(investigationPanelSource).toContain('canInvestigate?: boolean;');
    expect(investigationPanelSource).toContain('canCloseInvestigation?: boolean;');
    expect(investigationPanelSource).toContain("if (requestedStatus === 'closed')");
    expect(investigationPanelSource).toContain('} else if (!canInvestigate) {');
    expect(investigationPanelSource).toContain('!isClosed && canInvestigate && (');
  });

  it('gates direct legacy actions by the matching dedicated capability', () => {
    expect(pageSource).toContain('{capabilities.canCompleteDetails && (');
    expect(pageSource).toContain('{capabilities.canGenerateMva && (');
    expect(pageSource).toContain('{capabilities.canViewFiles && (');
    expect(pageSource).toContain('if (!capabilities.canGenerateMva) return;');
    expect(pageSource).toContain('if (!capabilities.canViewFiles) return;');
    expect(pageSource).toContain('if (!capabilities.canCompleteDetails) return;');
  });

  it('renders recorded vehicle and passenger safety separately from journey continuation', () => {
    expect(pageSource).toContain('vehicleSafe: boolean | null;');
    expect(pageSource).toContain('passengerSafe: boolean | null;');
    expect(pageSource).toContain('formatSafety(incident.vehicleSafe)');
    expect(pageSource).toContain('formatSafety(incident.passengerSafe)');
    expect(pageSource).toContain('Journey continuation: {incident.continuationState.replace');
    expect(pageSource).not.toContain("incident.safeToContinue ? 'Yes' : 'No'");
  });
});
