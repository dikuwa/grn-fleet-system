import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/vehicles/[id]/availability/route.ts'),
  'utf8',
);

describe('vehicle availability allocation-period expiry contract', () => {
  it('uses the requested period end as the compliance horizon', () => {
    expect(routeSource).toContain(
      'requestedEndDateOnly ?? startParam ?? new Date().toISOString().slice(0, 10)',
    );
  });

  it('applies that horizon to both vehicle licence and verified roadworthy evidence', () => {
    expect(routeSource).toContain(
      'vehicle.licenceExpiryDate && vehicle.licenceExpiryDate < complianceDate',
    );
    expect(routeSource).toContain(
      'roadworthyDocument?.expiryDate && roadworthyDocument.expiryDate < complianceDate',
    );
    expect(routeSource).toContain('expires before the requested period ends');
  });
});
