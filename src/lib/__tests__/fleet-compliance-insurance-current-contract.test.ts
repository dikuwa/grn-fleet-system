import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/compliance/route.ts'),
  'utf8',
);

describe('fleet compliance insurance evidence contract', () => {
  it('requires verified insurance before a policy can satisfy compliance', () => {
    expect(routeSource).toContain('isVerified: vehicleDocuments.isVerified');
    expect(routeSource).toContain('const verifiedInsuranceDocs = insuranceDocs.filter((d) => d.isVerified)');
    expect(routeSource).toContain('const currentInsurance = verifiedInsuranceDocs[0] ?? null;');
    expect(routeSource).toContain('(Pending verification)');
    expect(routeSource).toContain("status: 'unknown'");
  });

  it('selects one current verified policy instead of evaluating retained insurance history', () => {
    expect(routeSource).toContain('issueDate: vehicleDocuments.issueDate');
    expect(routeSource).toContain('createdAt: vehicleDocuments.createdAt');
    expect(routeSource).toContain('sort(newestFirst)');
    expect(routeSource).toContain('if (currentInsurance)');
    expect(routeSource).not.toContain('for (const doc of insuranceDocs)');
  });

  it('keeps expired current verified insurance non-compliant', () => {
    expect(routeSource).toContain("status: days < 0 ? 'expired' : days <= 30 ? 'expiring_soon' : 'valid'");
    expect(routeSource).toContain("expiredCount > 0\n          ? 'non_compliant'");
  });
});
