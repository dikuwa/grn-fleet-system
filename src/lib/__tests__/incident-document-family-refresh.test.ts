import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mvaSource = readFileSync(resolve(process.cwd(), 'src/lib/incidents/mva.ts'), 'utf8');
const documentRefreshSource = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/document-refresh.ts'),
  'utf8',
);
const investigationRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/investigation/route.ts'),
  'utf8',
);

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

  it('serializes mutable incident and Trip Completion drafts across concurrent serverless refreshes', () => {
    expect(documentRefreshSource).toContain('async function generateSerializedDocument(');
    expect(documentRefreshSource).toContain('pg_advisory_xact_lock');
    expect(documentRefreshSource).toContain('hashtextextended');
    expect(documentRefreshSource).toContain('payload.documentType');
    expect(documentRefreshSource).toContain('return generateDocument(payload);');
    expect(documentRefreshSource).toContain('generateSerializedDocument({');
  });

  it('surfaces rejected settled generation effects while preserving best-effort mutation semantics', () => {
    expect(documentRefreshSource).toContain('function logRejectedRefreshes(');
    expect(documentRefreshSource).toContain("if (result.status === 'rejected')");
    expect(documentRefreshSource).toContain("console.error(`[incidents/document-refresh] ${label} failed:`, result.reason)");
    expect(documentRefreshSource).toContain("logRejectedRefreshes('Operational document refresh', results)");
  });

  it('keeps investigation closure on the same single canonical refresh path', () => {
    expect(investigationRouteSource).not.toContain('refreshIncidentTripCompletionIfClosed');
    expect(investigationRouteSource).not.toContain("from '@/lib/incidents/document-refresh'");
    expect(investigationRouteSource).toContain('const result = await updateInvestigation(');
  });

  it('passes the incident trip id so rapid/non-MVA incidents refresh the correct report family', () => {
    expect(mvaSource).toContain('tripId,');
  });

  it('keeps explicit MVA report generation as accident-report generation', () => {
    const explicitGeneration = mvaSource.slice(mvaSource.indexOf('export async function generateMvaReport'));
    expect(explicitGeneration).toContain("documentType: 'accident_report'");
  });
});
