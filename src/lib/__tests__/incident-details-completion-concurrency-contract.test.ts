import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const mvaServiceSource = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/mva.ts'),
  'utf8',
);
const completionRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/complete/route.ts'),
  'utf8',
);

describe('incident details completion concurrency recovery', () => {
  it('claims the exact incident revision that was validated before completion', () => {
    const completeStart = mvaServiceSource.indexOf('export async function completeIncidentDetails');
    const clearanceStart = mvaServiceSource.indexOf('// Technical clearance', completeStart);
    const completionSource = mvaServiceSource.slice(completeStart, clearanceStart);

    expect(completionSource).toContain('eq(tripIncidents.updatedAt, incident.updatedAt)');
    expect(completionSource).toContain('eq(tripIncidents.detailsRequired, true)');
    expect(completionSource).toContain("sql`${tripIncidents.investigationStatus} <> 'closed'`");
    expect(completionSource).toContain("sql`${tripIncidents.status} <> 'resolved'`");
    expect(completionSource).toContain("error: 'details_completion_conflict'");
  });

  it('keeps immutable evidence of the validated source revision', () => {
    const completeStart = mvaServiceSource.indexOf('export async function completeIncidentDetails');
    const clearanceStart = mvaServiceSource.indexOf('// Technical clearance', completeStart);
    const completionSource = mvaServiceSource.slice(completeStart, clearanceStart);

    expect(completionSource).toContain('updatedAt: incident.updatedAt.toISOString()');
    expect(completionSource).toContain('description: incident.description');
    expect(completionSource).toContain('incidentType: incident.incidentType');
    expect(completionSource).toContain('detailsRequired: updated.detailsRequired');
  });

  it('returns a controlled conflict response rather than a generic server error', () => {
    expect(completionRouteSource).toContain("result.error === 'details_completion_conflict'");
    expect(completionRouteSource).toContain('{ status });');
    expect(completionRouteSource).toContain('Incident details changed while completion was being recorded. Refresh and review the current incident state.');
  });
});
