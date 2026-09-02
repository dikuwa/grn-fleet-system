import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const constantsSource = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/mva-constants.ts'),
  'utf8',
);
const reviewRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/review/route.ts'),
  'utf8',
);
const reviewActionsSource = readFileSync(
  resolve(
    process.cwd(),
    'src/app/(dashboard)/dashboard/trips/incidents/[id]/incident-review-actions.tsx',
  ),
  'utf8',
);
const investigationPanelSource = readFileSync(
  resolve(process.cwd(), 'src/components/incidents/InvestigationPanel.tsx'),
  'utf8',
);
const workspaceSource = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/dashboard/trips/incidents/page.tsx'),
  'utf8',
);
const dashboardAccessSource = readFileSync(
  resolve(process.cwd(), 'src/lib/dashboard-access.ts'),
  'utf8',
);

describe('incident investigation status parity', () => {
  it('keeps both historically supported open statuses in the shared vocabulary', () => {
    expect(constantsSource).toContain("| 'awaiting_information'");
    expect(constantsSource).toContain("| 'no_action'");
    expect(constantsSource).toContain("awaiting_information: 'Awaiting information'");
    expect(constantsSource).toContain("no_action: 'No action required'");
  });

  it('lets the unified review API preserve either compatible open status', () => {
    expect(reviewRouteSource).toContain("'awaiting_information',\n  'no_action',");
    expect(reviewRouteSource).toContain('awaiting information, or no action required');
  });

  it('offers the same open statuses on both review surfaces while keeping closure separate', () => {
    expect(reviewActionsSource).toContain('<option value="awaiting_information">Awaiting information</option>');
    expect(reviewActionsSource).toContain('<option value="no_action">No action required</option>');
    expect(investigationPanelSource).toContain("awaiting_information: 'Awaiting information'");
    expect(investigationPanelSource).toContain("(status) => status !== 'closed'");
  });

  it('keeps no-action investigations visible in the operational Open workspace', () => {
    expect(workspaceSource).toContain(
      "['pending', 'in_progress', 'awaiting_information', 'no_action']",
    );
    expect(workspaceSource).toContain("row.investigationStatus !== 'closed'");
  });

  it('lets dedicated follow-up roles enter the same MVA workspace as their detail actions', () => {
    expect(workspaceSource).toContain('Permissions.INCIDENT_CLOSE_INVESTIGATION');
    expect(workspaceSource).toContain('Permissions.INCIDENT_INSURANCE_UPDATE');
    expect(workspaceSource).toContain('Permissions.INCIDENT_TECHNICAL_CLEARANCE');
    expect(workspaceSource).toContain('Permissions.MAINTENANCE_MANAGE');
  });

  it('registers incident review narrowly for Maintenance without widening the Trips workspace', () => {
    expect(dashboardAccessSource).toContain("id: 'trip-incidents'");
    expect(dashboardAccessSource).toContain("path: '/dashboard/trips/incidents'");
    expect(dashboardAccessSource).toContain(
      'workspaces: [W.MAINTENANCE, W.TRANSPORT_ADMIN, W.AUDIT]',
    );
    expect(dashboardAccessSource).toContain('[W.MAINTENANCE]: relatedRead()');
    expect(dashboardAccessSource).toContain("label: 'Incident Review'");
    expect(dashboardAccessSource).toContain('navigationVisible: true');
    expect(dashboardAccessSource).toContain(
      "workspaces: [W.DRIVER, W.TRANSPORT_ADMIN, W.AUDIT]",
    );
  });
});
