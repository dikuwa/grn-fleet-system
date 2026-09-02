import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/incidents/InsuranceTrackingPanel.tsx'),
  'utf8',
);

describe('incident insurance clearing contract', () => {
  it('clears represented third-party fields only when the officer changes them', () => {
    expect(source).toContain('const thirdPartyFieldsChanged =');
    expect(source).toContain('if (thirdPartyFieldsChanged)');
    expect(source).toContain('body.thirdPartyInsuranceDetails = Object.keys(nextThirdPartyDetails).length');
    expect(source).toContain(': null;');
  });

  it('preserves hidden custom metadata while normalizing known legacy aliases', () => {
    expect(source).toContain("'insurer'");
    expect(source).toContain("'phone'");
    expect(source).toContain("'policy'");
    expect(source).toContain("'description'");
    expect(source).toContain('preservedHiddenDetails');
    expect(source).toContain('!THIRD_PARTY_FORM_KEYS.has(key)');
  });

  it('normalizes saved insurance strings before persistence', () => {
    expect(source).toContain('insuranceClaimReference: claimRef.trim() || null');
    expect(source).toContain('insurerName: tpInsurerName.trim()');
    expect(source).toContain('insurerPhone: tpInsurerPhone.trim()');
    expect(source).toContain('policyNumber: tpInsurerPolicy.trim()');
    expect(source).toContain('details: tpDetails.trim()');
  });
});
