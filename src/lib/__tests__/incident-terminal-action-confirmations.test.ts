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
});
