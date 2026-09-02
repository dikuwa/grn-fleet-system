import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mvaSource = readFileSync(resolve(process.cwd(), 'src/lib/incidents/mva.ts'), 'utf8');

describe('incident mutation document refresh', () => {
  it('refreshes the canonical incident document family after ordinary incident mutations', () => {
    expect(mvaSource).toContain("import { refreshIncidentOperationalDocuments } from '@/lib/incidents/document-refresh';");
    expect(mvaSource).toContain('async function refreshIncidentDocuments(');
    expect(mvaSource).toContain('await refreshIncidentOperationalDocuments({');
    expect(mvaSource).not.toContain('function regenerateMvaReport(');
  });

  it('awaits the best-effort refresh so serverless responses do not abandon document work', () => {
    const refreshCall = 'await refreshIncidentDocuments(tenantId, incidentId, incident.tripId, actorUserId)';
    expect(mvaSource.split(refreshCall).length - 1).toBe(4);
    expect(mvaSource).toContain("console.error('[mva] Incident document refresh failed:', err)");
    expect(mvaSource).not.toContain('void refreshIncidentOperationalDocuments');
  });

  it('passes the incident trip id so rapid/non-MVA incidents refresh the correct report family', () => {
    expect(mvaSource).toContain('tripId,');
  });

  it('keeps explicit MVA report generation as accident-report generation', () => {
    const explicitGeneration = mvaSource.slice(mvaSource.indexOf('export async function generateMvaReport'));
    expect(explicitGeneration).toContain("documentType: 'accident_report'");
  });
});
