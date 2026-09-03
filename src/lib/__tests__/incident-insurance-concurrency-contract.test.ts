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

describe('incident insurance concurrency recovery', () => {
  it('claims the exact incident revision in canonical incident review', () => {
    expect(reviewRouteSource).toContain("if (action === 'insurance_update')");
    expect(reviewRouteSource).toContain('WITH incident_claim AS');
    expect(reviewRouteSource).toContain('ti.updated_at = ${context.incident.updatedAt}::timestamptz');
    expect(reviewRouteSource).toContain('FROM incident_claim');
    expect(reviewRouteSource).toContain("'incident_insurance_update_conflict'");
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

  it('guards the shared insurance service against stale writes and orphan audit events', () => {
    expect(mvaServiceSource).toContain('eq(tripIncidents.updatedAt, incident.updatedAt)');
    expect(mvaServiceSource).toContain('if (!updated) return null;');
    expect(mvaServiceSource).toContain("error: 'insurance_update_conflict'");
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
