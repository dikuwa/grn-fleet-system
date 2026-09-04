import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/documents/route.ts'),
  'utf8',
);

describe('vehicle document date validation contract', () => {
  it('validates optional evidence dates before persistence', () => {
    expect(routeSource).toContain('function isDateOnly(value: string)');
    expect(routeSource).toContain("error: 'Issue date must use YYYY-MM-DD'");
    expect(routeSource).toContain("error: 'Expiry date must use YYYY-MM-DD'");
    expect(routeSource).toContain('{ status: 422 }');
  });

  it('rejects an expiry date before the issue date', () => {
    expect(routeSource).toContain('if (issueDate && expiryDate && expiryDate < issueDate)');
    expect(routeSource).toContain("error: 'Expiry date cannot be before the issue date'");
  });

  it('persists only the validated normalized date values', () => {
    expect(routeSource).toContain("const issueDate = String(body.issueDate || '').trim() || null;");
    expect(routeSource).toContain("const expiryDate = String(body.expiryDate || '').trim() || null;");
    expect(routeSource).toContain('issueDate,\n          expiryDate,');
  });
});
