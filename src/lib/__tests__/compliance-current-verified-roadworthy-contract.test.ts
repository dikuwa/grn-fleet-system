import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/compliance/route.ts'),
  'utf8',
);

describe('current verified roadworthy compliance contract', () => {
  it('prefers the newest verified roadworthy document', () => {
    expect(routeSource).toContain("d.documentType === 'roadworthy' && d.isVerified");
    expect(routeSource).toContain('.sort(newestDocumentFirst)');
    expect(routeSource).toContain('const currentRoadworthy = verifiedRoadworthyDocs[0] ?? null;');
    expect(routeSource).toContain('currentRoadworthy.expiryDate');
  });

  it('retains the legacy roadworthy test date only as fallback', () => {
    const verifiedBranch = routeSource.indexOf('if (currentRoadworthy?.expiryDate)');
    const legacyBranch = routeSource.indexOf('else if (v.roadworthyTestDate)');
    expect(verifiedBranch).toBeGreaterThan(-1);
    expect(legacyBranch).toBeGreaterThan(verifiedBranch);
  });

  it('reuses the same retained-document ordering for insurance and roadworthy', () => {
    expect(routeSource).toContain('const newestDocumentFirst =');
    expect(routeSource).toContain('verifiedInsuranceDocs');
    expect(routeSource).not.toContain('const newestFirst =');
  });
});
