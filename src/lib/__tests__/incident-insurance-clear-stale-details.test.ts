import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/incidents/InsuranceTrackingPanel.tsx'),
  'utf8',
);

describe('incident insurance clearing contract', () => {
  it('sends explicit null when all third-party insurance fields are cleared', () => {
    expect(source).toContain('const hasThirdPartyInsuranceDetails = Boolean(');
    expect(source).toContain('thirdPartyInsuranceDetails: hasThirdPartyInsuranceDetails');
    expect(source).toContain(': null,');
  });

  it('normalizes saved insurance strings before persistence', () => {
    expect(source).toContain('insuranceClaimReference: claimRef.trim() || null');
    expect(source).toContain('insurerName: tpInsurerName.trim()');
    expect(source).toContain('insurerPhone: tpInsurerPhone.trim()');
    expect(source).toContain('policyNumber: tpInsurerPolicy.trim()');
    expect(source).toContain('details: tpDetails.trim()');
  });
});
