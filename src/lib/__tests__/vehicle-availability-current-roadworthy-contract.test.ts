import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/vehicles/[id]/availability/route.ts'),
  'utf8',
);

describe('vehicle availability current verified roadworthy contract', () => {
  it('selects current verified evidence by issue/upload chronology instead of furthest expiry', () => {
    expect(routeSource).toContain('eq(vehicleDocuments.documentType, \'roadworthy\')');
    expect(routeSource).toContain('eq(vehicleDocuments.isVerified, true)');
    expect(routeSource).toContain(
      'COALESCE(${vehicleDocuments.issueDate}::timestamptz, ${vehicleDocuments.createdAt})',
    );
    expect(routeSource).not.toContain('.orderBy(desc(vehicleDocuments.expiryDate))');
  });

  it('does not skip the newest verified record merely because expiry is absent', () => {
    const roadworthyQueryStart = routeSource.indexOf('const [roadworthyDocument]');
    const roadworthyCheckStart = routeSource.indexOf(
      'if (roadworthyDocument?.expiryDate && roadworthyDocument.expiryDate < complianceDate)',
    );
    const querySource = routeSource.slice(roadworthyQueryStart, roadworthyCheckStart);
    expect(querySource).not.toContain('isNotNull(vehicleDocuments.expiryDate)');
  });
});
