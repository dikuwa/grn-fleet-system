import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reviewRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/review/route.ts'),
  'utf8',
);
const dedicatedRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/insurance/route.ts'),
  'utf8',
);

describe('unified incident insurance validation parity', () => {
  it('rejects malformed insurance notification and claim-reference types', () => {
    for (const source of [reviewRoute, dedicatedRoute]) {
      expect(source).toContain("typeof body.insuranceNotified !== 'boolean'");
      expect(source).toContain("typeof body.insuranceClaimReference !== 'string'");
      expect(source).toContain('Insurance notified must be true or false');
      expect(source).toContain('Insurance claim reference must be text or null');
    }
  });

  it('preserves omitted values instead of silently clearing insurance state', () => {
    expect(reviewRoute).toContain("typeof body.insuranceNotified === 'boolean'");
    expect(reviewRoute).toContain(': context.incident.insuranceNotified;');
    expect(reviewRoute).toContain('body.insuranceClaimReference === undefined');
    expect(reviewRoute).toContain('? context.incident.insuranceClaimReference');
  });

  it('trims explicit claim references and preserves explicit null', () => {
    expect(reviewRoute).toContain("body.insuranceClaimReference.trim() || null");
    expect(reviewRoute).toContain("'insuranceNotified', ${insuranceNotified}");
    expect(reviewRoute).toContain("'insuranceClaimReference', ${insuranceClaimReference}");
    expect(reviewRoute).not.toContain('after: { insuranceNotified, insuranceClaimReference }');
    expect(reviewRoute).not.toContain('body.insuranceClaimReference ? String(body.insuranceClaimReference).trim() : null');
    expect(reviewRoute).not.toContain('const insuranceNotified = body.insuranceNotified === true;');
  });
});
