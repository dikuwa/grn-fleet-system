import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(
    process.cwd(),
    'src/app/(dashboard)/dashboard/trips/incidents/[id]/incident-review-actions.tsx',
  ),
  'utf8',
);
const investigationRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/investigation/route.ts'),
  'utf8',
);
const mvaSource = readFileSync(resolve(process.cwd(), 'src/lib/incidents/mva.ts'), 'utf8');
const documentRefreshSource = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/document-refresh.ts'),
  'utf8',
);

describe('incident terminal action confirmation contract', () => {
  it('requires explicit confirmation for consequential terminal actions', () => {
    expect(source).toContain("setPendingConfirmedAction('technical_clearance')");
    expect(source).toContain("setPendingConfirmedAction('return_vehicle_to_service')");
    expect(source).toContain("setPendingConfirmedAction('close_investigation')");
    expect(source).toContain('<ConfirmDialog');
    expect(source).toContain('onConfirm={confirmPendingAction}');
  });

  it('routes final investigation closure through the dedicated governed endpoint', () => {
    expect(source).toContain("fetch(`/api/incidents/${incidentId}/investigation`");
    expect(source).toContain("status: 'closed'");
    expect(source).toContain('notes: form.investigationNotes.trim()');
    expect(source).not.toContain("submitReview('close_investigation')");
  });

  it('fails closed in the UI when final investigation findings are missing', () => {
    expect(source).toContain('disabled={!form.investigationNotes.trim()}');
    expect(source).toContain('Add investigation findings before final closure.');
    expect(source).toContain('Investigation notes are required');
  });

  it('explains the server-side safety rechecks before return to service', () => {
    expect(source).toContain('The server will recheck blocking defects, active trips and unresolved safety incidents');
  });

  it('refreshes Trip Completion through the single canonical mutation refresh without duplicating closure side effects', () => {
    expect(investigationRouteSource).not.toContain('refreshIncidentTripCompletionIfClosed');
    expect(mvaSource).toContain(
      'await refreshIncidentDocuments(tenantId, incidentId, incident.tripId, actorUserId)',
    );
    expect(mvaSource).toContain('await refreshIncidentOperationalDocuments({');
    expect(mvaSource).toContain("console.error('[mva] Incident document refresh failed:', err)");
    expect(documentRefreshSource).toContain("if (trip?.status !== 'closed') return [];");
    expect(documentRefreshSource).toContain('const results = await Promise.allSettled([');
    expect(documentRefreshSource).toContain("logRejectedRefreshes('Trip Completion refresh', results);");
    expect(documentRefreshSource).toContain('return results;');
    expect(documentRefreshSource).toContain("documentType: 'trip_completion'");
  });
});
