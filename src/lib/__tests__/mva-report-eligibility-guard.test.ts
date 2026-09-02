import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/mva-report/route.ts'),
  'utf8',
);

describe('MVA report eligibility contract', () => {
  it('uses the canonical incident/category MVA predicate', () => {
    expect(routeSource).toContain("getIncidentCategory(tenantId, incident.incidentCategoryCode)");
    expect(routeSource).toContain('requiresMvaForm({');
    expect(routeSource).toContain('requiresMvaForm: category?.requiresMvaForm ?? false');
    expect(routeSource).toContain("severity: incident.severity as CreateIncidentInput['severity']");
  });

  it('checks MVA eligibility before GET document lookup and POST generation', () => {
    const guard = 'if (!(await isMvaEligibleIncident(session.tenantId, incident)))';
    expect(routeSource.split(guard)).toHaveLength(3);

    const postMarker = '// POST — Generate/regenerate the MVA report document';
    const postMarkerIndex = routeSource.indexOf(postMarker);
    expect(postMarkerIndex).toBeGreaterThan(-1);

    const getSection = routeSource.slice(0, postMarkerIndex);
    const postSection = routeSource.slice(postMarkerIndex);
    expect(getSection.indexOf(guard)).toBeGreaterThan(-1);
    expect(getSection.indexOf(guard)).toBeLessThan(getSection.indexOf('const db = getDb();'));
    expect(postSection.indexOf(guard)).toBeGreaterThan(-1);
    expect(postSection.indexOf(guard)).toBeLessThan(postSection.indexOf('const result = await generateMvaReport('));
  });

  it('returns a controlled conflict instead of creating or serving an accident report for a non-MVA incident', () => {
    expect(routeSource).toContain('This incident does not require a Motor Vehicle Accident report.');
    expect(routeSource).toContain('{ status: 409 }');
  });
});
