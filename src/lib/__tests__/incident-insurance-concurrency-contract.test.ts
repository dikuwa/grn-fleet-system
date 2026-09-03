import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/review/route.ts'),
  'utf8',
);

describe('incident insurance concurrency recovery', () => {
  it('claims the exact incident revision before writing insurance state', () => {
    expect(routeSource).toContain("if (action === 'insurance_update')");
    expect(routeSource).toContain('WITH incident_claim AS');
    expect(routeSource).toContain('ti.updated_at = ${context.incident.updatedAt}::timestamptz');
    expect(routeSource).toContain('FROM incident_claim');
    expect(routeSource).toContain("'incident_insurance_update_conflict'");
  });

  it('writes immutable before/after insurance evidence only for the successful claim', () => {
    expect(routeSource).toContain("'incident_insurance_updated'");
    expect(routeSource).toContain("'incident.insurance.update'");
    expect(routeSource).toContain("'insuranceNotified', ${context.incident.insuranceNotified}");
    expect(routeSource).toContain("'updatedAt', ${context.incident.updatedAt.toISOString()}");
    expect(routeSource).toContain("'insuranceNotified', ${insuranceNotified}");
  });

  it('maps a lost insurance revision race to a controlled 409', () => {
    expect(routeSource).toContain("message.includes('incident_insurance_update_conflict')");
    expect(routeSource).toContain('The incident changed while insurance details were being saved. Refresh the incident and review the latest insurance state.');
    expect(routeSource).toContain('{ status: 409 }');
  });
});
