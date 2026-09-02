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

  it('fails closed instead of treating generic incident management as every MVA capability', () => {
    expect(pageSource).toContain("fetch('/api/incidents/capabilities')");
    expect(pageSource).toContain('setCapabilities(EMPTY_CAPABILITIES)');
    expect(pageSource).not.toContain('{canManage && (');
    expect(pageSource).not.toContain('if (!canManage) return;');
  });

  it('gates each legacy action surface by the matching dedicated capability', () => {
    expect(pageSource).toContain('{capabilities.canCompleteDetails && (');
    expect(pageSource).toContain('{capabilities.canInvestigate && (');
    expect(pageSource).toContain('{capabilities.canInsuranceUpdate && (');
    expect(pageSource).toContain('{capabilities.canTechnicalClearance && (');
    expect(pageSource).toContain('{capabilities.canGenerateMva && (');
    expect(pageSource).toContain('{capabilities.canViewFiles && (');
  });

  it('guards mutation callbacks as well as hiding their controls', () => {
    expect(pageSource).toContain('if (!capabilities.canGenerateMva) return;');
    expect(pageSource).toContain('if (!capabilities.canViewFiles) return;');
    expect(pageSource).toContain('if (!capabilities.canCompleteDetails) return;');
  });
});
