import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reviewRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/review/route.ts'),
  'utf8',
);
const insuranceRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/insurance/route.ts'),
  'utf8',
);
const mvaServiceSource = readFileSync(
  resolve(process.cwd(), 'src/lib/incidents/mva.ts'),
  'utf8',
);

describe('incident review concurrency recovery', () => {
  it('claims the exact incident revision in canonical insurance review', () => {
    expect(reviewRouteSource).toContain("if (action === 'insurance_update')");
    expect(reviewRouteSource).toContain('WITH incident_claim AS');
    expect(reviewRouteSource).toContain('ti.updated_at = ${context.incident.updatedAt}::timestamptz');
    expect(reviewRouteSource).toContain('FROM incident_claim');
    expect(reviewRouteSource).toContain("'incident_insurance_update_conflict'");
  });

  it('claims the exact incident revision in canonical investigation review', () => {
    expect(reviewRouteSource).toContain("if (action === 'investigation_update')");
    expect(reviewRouteSource).toContain('AND ti.updated_at = ${context.incident.updatedAt}::timestamptz');
    expect(reviewRouteSource).toContain("'incident_investigation_update_conflict'");
    expect(reviewRouteSource).toContain("message.includes('incident_investigation_update_conflict')");
  });

  it('writes immutable before/after insurance evidence only for the successful canonical claim', () => {
    expect(reviewRouteSource).toContain("'incident_insurance_updated'");
    expect(reviewRouteSource).toContain("'incident.insurance.update'");
    expect(reviewRouteSource).toContain("'insuranceNotified', ${context.incident.insuranceNotified}");
    expect(reviewRouteSource).toContain("'updatedAt', ${context.incident.updatedAt.toISOString()}");
    expect(reviewRouteSource).toContain("'insuranceNotified', ${insuranceNotified}");
  });

  it('maps a lost canonical insurance revision race to a controlled 409', () => {
    expect(reviewRouteSource).toContain("message.includes('incident_insurance_update_conflict')");
    expect(reviewRouteSource).toContain('The incident changed while insurance details were being saved. Refresh the incident and review the latest insurance state.');
    expect(reviewRouteSource).toContain('{ status: 409 }');
  });

  it('guards shared investigation and insurance services against stale writes', () => {
    expect(mvaServiceSource.match(/eq\(tripIncidents\.updatedAt, incident\.updatedAt\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(mvaServiceSource).toContain("error: 'investigation_update_conflict'");
    expect(mvaServiceSource).toContain("error: 'insurance_update_conflict'");
    expect(mvaServiceSource).toContain('if (!updated) return null;');
  });

  it('keeps shared insurance audit evidence behind the successful revision claim', () => {
    expect(mvaServiceSource.indexOf('if (!updated) return null;')).toBeLessThan(
      mvaServiceSource.indexOf("eventType: 'incident_insurance_updated'"),
    );
    expect(mvaServiceSource).toContain('updatedAt: incident.updatedAt.toISOString()');
  });

  it('returns 409 from the dedicated insurance endpoint when the shared revision claim loses', () => {
    expect(insuranceRouteSource).toContain("result.error === 'insurance_update_conflict'");
    expect(insuranceRouteSource).toContain('? 409');
  });
});
