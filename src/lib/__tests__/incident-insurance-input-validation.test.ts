import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/insurance/route.ts'),
  'utf8',
);

describe('incident insurance input validation contract', () => {
  it('rejects malformed runtime boolean values before database mutation', () => {
    expect(routeSource).toContain("typeof body.insuranceNotified !== 'boolean'");
    expect(routeSource).toContain("typeof body.policeReportFiled !== 'boolean'");
    expect(routeSource).toContain("{ status: 422 }");
  });

  it('accepts only object-or-null third-party insurance details', () => {
    expect(routeSource).toContain("typeof body.thirdPartyInsuranceDetails !== 'object'");
    expect(routeSource).toContain('Array.isArray(body.thirdPartyInsuranceDetails)');
    expect(routeSource).toContain('Third-party insurance details must be an object or null');
  });

  it('normalizes claim-reference text without changing explicit null clearing', () => {
    expect(routeSource).toContain("typeof body.insuranceClaimReference === 'string'");
    expect(routeSource).toContain('body.insuranceClaimReference.trim() || null');
    expect(routeSource).toContain(': body.insuranceClaimReference,');
  });
});
