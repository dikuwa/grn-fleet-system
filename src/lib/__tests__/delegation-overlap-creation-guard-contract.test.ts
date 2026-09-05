import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const route = readFileSync(resolve(process.cwd(), 'src/app/api/delegations/route.ts'), 'utf8');
const migration = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0114_delegation_overlap_creation_guard.sql'),
  'utf8',
);

describe('delegation overlap creation guard', () => {
  it('serializes normal creation per tenant before checking overlapping role or acting employee windows', () => {
    expect(migration).toContain("hashtextextended('role_delegation_creation:' || NEW.tenant_id::text, 0)");
    expect(migration).toContain("existing.status IN ('scheduled', 'active')");
    expect(migration).toContain('existing.start_at < NEW.end_at');
    expect(migration).toContain('existing.end_at > NEW.start_at');
    expect(migration).toContain('existing.role_id = NEW.role_id');
    expect(migration).toContain('existing.acting_employee_id = NEW.acting_employee_id');
    expect(migration).toContain("RAISE EXCEPTION 'role_delegation_overlap_conflict'");
    expect(migration).toContain("ERRCODE = '23P01'");
  });

  it('preserves explicit conflict overrides instead of blocking authorised appointments at the database layer', () => {
    const overrideIndex = migration.indexOf("NULLIF(BTRIM(COALESCE(NEW.override_reason, '')), '') IS NOT NULL");
    const lockIndex = migration.indexOf('pg_advisory_xact_lock');
    expect(overrideIndex).toBeGreaterThan(0);
    expect(lockIndex).toBeGreaterThan(overrideIndex);
    expect(migration.slice(overrideIndex, lockIndex)).toContain('RETURN NEW');
  });

  it('maps a deeply wrapped database race to the existing controlled 409 conflict surface before audit evidence is written', () => {
    const nested = new Error('outer wrapper', {
      cause: new Error('drizzle wrapper', {
        cause: Object.assign(new Error('role_delegation_overlap_conflict'), { code: '23P01' }),
      }),
    });

    expect(getDatabaseErrorDetails(nested).message).toContain('role_delegation_overlap_conflict');
    expect(route).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(route).toContain("if (message.includes('role_delegation_overlap_conflict'))");
    expect(route).toContain("error: 'Delegation conflicts must be resolved or overridden'");
    expect(route).toContain('{ status: 409 }');

    const insertIndex = route.indexOf('const [delegation] = await db.insert(roleDelegations)');
    const catchIndex = route.indexOf('} catch (error) {', insertIndex);
    const auditIndex = route.indexOf("action: 'delegation.created'", insertIndex);
    expect(insertIndex).toBeGreaterThan(0);
    expect(auditIndex).toBeGreaterThan(insertIndex);
    expect(catchIndex).toBeGreaterThan(auditIndex);
  });
});
