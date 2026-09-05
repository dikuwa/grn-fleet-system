import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/user-membership-integrity.ts'),
  'utf8',
);

describe('global user membership invariant helper', () => {
  it('takes a user-scoped transaction lock before checking other memberships', () => {
    const lock = source.indexOf('pg_advisory_xact_lock');
    const query = source.indexOf('.from(tenantMemberships)', lock);

    expect(lock).toBeGreaterThan(-1);
    expect(query).toBeGreaterThan(lock);
  });

  it('excludes the membership being changed and ignores access-removed memberships', () => {
    expect(source).toContain('ne(tenantMemberships.id, excludedMembershipId)');
    expect(source).toContain("ne(tenantMemberships.status, 'access_removed')");
  });
});
