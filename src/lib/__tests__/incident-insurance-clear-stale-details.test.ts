import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/incidents/InsuranceTrackingPanel.tsx'),
  'utf8',
);

describe('incident insurance clearing contract', () => {
  it('updates only represented third-party field groups the officer changed', () => {
    expect(source).toContain('const changedFields = {');
    expect(source).toContain('const thirdPartyFieldsChanged = Object.values(changedFields).some(Boolean)');
    expect(source).toContain('const nextThirdPartyDetails: Record<string, unknown> = { ...storedThirdPartyDetails }');
    expect(source).toContain('if (changedFields.insurerName)');
    expect(source).toContain('if (changedFields.insurerPhone)');
    expect(source).toContain('if (changedFields.policyNumber)');
    expect(source).toContain('if (changedFields.details)');
  });

  it('preserves untouched legacy/custom values and supports scalar display normalization', () => {
    expect(source).toContain("insurerName: ['insurerName', 'insurer']");
    expect(source).toContain("insurerPhone: ['insurerPhone', 'phone']");
    expect(source).toContain("policyNumber: ['policyNumber', 'policy']");
    expect(source).toContain("details: ['details', 'description']");
    expect(source).toContain("typeof value === 'number'");
    expect(source).toContain("typeof value === 'boolean'");
    expect(source).toContain('return String(value)');
  });

  it('removes only aliases for a field that is explicitly replaced or cleared', () => {
    expect(source).toContain('for (const alias of aliases) delete target[alias]');
    expect(source).toContain('if (value) target[canonicalKey] = value');
    expect(source).toContain('body.thirdPartyInsuranceDetails = Object.keys(nextThirdPartyDetails).length');
    expect(source).toContain(': null;');
  });

  it('normalizes saved insurance strings before persistence', () => {
    expect(source).toContain('insuranceClaimReference: claimRef.trim() || null');
    expect(source).toContain('insurerName: tpInsurerName.trim()');
    expect(source).toContain('insurerPhone: tpInsurerPhone.trim()');
    expect(source).toContain('policyNumber: tpInsurerPolicy.trim()');
    expect(source).toContain('details: tpDetails.trim()');
  });
});
