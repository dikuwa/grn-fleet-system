import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync(
  resolve(process.cwd(), 'src/components/incidents/InvestigationPanel.tsx'),
  'utf8',
);
const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/investigation/route.ts'),
  'utf8',
);

describe('incident investigation close capability contract', () => {
  it('keeps final closure out of the ordinary status selector', () => {
    expect(panelSource).toContain("(status) => status !== 'closed'");
    expect(panelSource).toContain('Final closure is a separate governed action');
  });

  it('exposes the dedicated close capability from the investigation GET endpoint', () => {
    expect(routeSource).toContain('Permissions.INCIDENT_CLOSE_INVESTIGATION');
    expect(routeSource).toContain('const canCloseInvestigation = !(closePermission instanceof NextResponse)');
    expect(routeSource).toContain('canCloseInvestigation,');
  });

  it('fails closed while supporting an explicitly resolved close capability', () => {
    expect(panelSource).toContain('canCloseInvestigation?: boolean;');
    expect(panelSource).toContain('explicitCanCloseInvestigation ?? false');
    expect(panelSource).toContain('explicitCanCloseInvestigation !== undefined');
    expect(panelSource).toContain("json.capabilities?.canCloseInvestigation === true");
    expect(panelSource).toContain("if (requestedStatus === 'closed')");
    expect(panelSource).toContain('if (!canCloseInvestigation) return;');
    expect(panelSource).toContain('Closure requires an authorised closing officer.');
  });

  it('uses an explicit confirmation for terminal closure', () => {
    expect(panelSource).toContain('title="Close investigation?"');
    expect(panelSource).toContain("onConfirm={() => saveInvestigation('closed')}");
    expect(panelSource).toContain('Closed incident evidence cannot be reopened');
  });
});
