import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/tenant-user-capacity.ts'),
  'utf8',
);

describe('tenant user capacity helper', () => {
  it('takes a tenant-scoped transaction lock before recounting memberships', () => {
    const lock = source.indexOf('pg_advisory_xact_lock');
    const countQuery = source.indexOf('.from(tenantMemberships)', lock);

    expect(lock).toBeGreaterThan(-1);
    expect(countQuery).toBeGreaterThan(lock);
  });

  it('counts every membership state that consumes user capacity', () => {
    expect(source).toContain("['active', 'pending', 'pending_activation', 'suspended']");
  });

  it('reuses the central user entitlement calculation after the locked recount', () => {
    const recount = source.indexOf('.from(tenantMemberships)');
    const entitlement = source.indexOf("checkEntitlement(entitlements, 'users'", recount);

    expect(entitlement).toBeGreaterThan(recount);
  });
});
