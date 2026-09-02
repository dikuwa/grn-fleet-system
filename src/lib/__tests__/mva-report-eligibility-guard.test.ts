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

    const getSection = routeSource.split('// ---------------------------------------------------------------------------\n// POST')[0];
    expect(getSection.indexOf(guard)).toBeLessThan(getSection.indexOf('const db = getDb();'));

    const postSection = routeSource.split('// POST — Generate/regenerate the MVA report document snapshot')[1];
    expect(postSection.indexOf(guard)).toBeLessThan(postSection.indexOf('const result = await generateMvaReport('));
  });

  it('returns a controlled conflict instead of creating or serving an accident report for a non-MVA incident', () => {
    expect(routeSource).toContain('This incident does not require a Motor Vehicle Accident report.');
    expect(routeSource).toContain('{ status: 409 }');
  });
});
