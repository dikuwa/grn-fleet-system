import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0115_role_assignment_window_integrity.sql'),
  'utf8',
);

describe('role assignment window integrity migration', () => {
  it('removes the legacy one-row-per-membership-role index', () => {
    expect(migration).toContain('DROP INDEX IF EXISTS "role_assignments_membership_role_unique"');
  });

  it('permits dated history while blocking overlapping membership-role windows', () => {
    expect(migration).toContain('role_assignments_no_overlapping_windows');
    expect(migration).toContain('"tenant_membership_id" WITH =');
    expect(migration).toContain('"role_id" WITH =');
    expect(migration).toContain("tstzrange(\"start_date\", \"end_date\", '[)') WITH &&");
  });
});
