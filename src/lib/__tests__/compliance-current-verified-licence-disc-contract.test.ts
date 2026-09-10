import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/compliance/route.ts'),
  'utf8',
);

describe('current verified licence-disc compliance contract', () => {
  it('prefers the newest verified licence disc over legacy vehicle expiry', () => {
    expect(routeSource).toContain("d.documentType === 'licence_disc' && d.isVerified");
    expect(routeSource).toContain('.sort(newestDocumentFirst)');
    expect(routeSource).toContain('const currentLicence = verifiedLicenceDocs[0] ?? null;');
    expect(routeSource).toContain(
      'const licenceExpiryDate = currentLicence?.expiryDate ?? v.licenceExpiryDate;',
    );
  });

  it('does not treat an unverified licence disc as authoritative compliance evidence', () => {
    expect(routeSource).toContain("d.documentType === 'licence_disc' && d.isVerified");
    expect(routeSource).not.toContain("d.documentType === 'licence_disc' && !d.isVerified");
  });

  it('retains the legacy licence expiry only as fallback', () => {
    const verifiedSelection = routeSource.indexOf('const currentLicence = verifiedLicenceDocs[0] ?? null;');
    const fallback = routeSource.indexOf(
      'const licenceExpiryDate = currentLicence?.expiryDate ?? v.licenceExpiryDate;',
    );
    const complianceBranch = routeSource.indexOf('if (licenceExpiryDate)');

    expect(verifiedSelection).toBeGreaterThan(-1);
    expect(fallback).toBeGreaterThan(verifiedSelection);
    expect(complianceBranch).toBeGreaterThan(fallback);
  });

  it('keeps document evidence tenant-scoped through the tenant vehicle subquery', () => {
    expect(routeSource).toContain(
      'IN (SELECT id FROM vehicles WHERE tenant_id = ${session.tenantId})',
    );
  });
});
