import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/authority/number/route.ts'),
  'utf8',
);

describe('Trip Authority number UUID guard', () => {
  it('preserves validation and permission precedence before guarding DB access', () => {
    const permissionIndex = route.indexOf(
      'const permission = await requirePermission(session, Permissions.TRIP_AUTHORITY_OVERRIDE_NUMBER)',
    );
    const authorityNumberValidationIndex = route.indexOf('authorityNumber = validateManualAuthorityNumber');
    const reasonValidationIndex = route.indexOf('if (reason.length > 500)');
    const guardIndex = route.indexOf('if (!UUID_PATTERN.test(tripId))');
    const dbIndex = route.indexOf('const db = getDb()');

    expect(route).toContain('const UUID_PATTERN =');
    expect(route).toContain("{ error: 'Trip Authority not found' }, { status: 404 }");
    expect(permissionIndex).toBeGreaterThan(-1);
    expect(authorityNumberValidationIndex).toBeGreaterThan(permissionIndex);
    expect(reasonValidationIndex).toBeGreaterThan(authorityNumberValidationIndex);
    expect(guardIndex).toBeGreaterThan(reasonValidationIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps concurrent authority-number correction conflict semantics intact', () => {
    expect(route).toContain('authority_number_correction_conflict');
    expect(route).toContain("(error as { code?: string })?.code === '23505'");
    expect(route).toContain('{ status: 409 }');
  });
});
