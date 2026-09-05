import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const departmentSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/departments/route.ts'),
  'utf8',
);
const officeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/offices/route.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0115_organisation_code_uniqueness.sql'),
  'utf8',
);

describe('organisation admin UUID and code invariants', () => {
  it('guards shared department ids and UUID-backed references before database lookups', () => {
    expect(departmentSource).toContain('const UUID_PATTERN =');
    expect(departmentSource).toContain("if (!isUuid(id)) {");
    expect(departmentSource).toContain("{ error: 'Organisation unit not found.' }, { status: 404 }");
    expect(departmentSource).toContain("if (parentId && !isUuid(parentId)) return 'The selected parent unit does not belong to this tenant.';");
    expect(departmentSource).toContain('if (!isUuid(officeId))');
    expect(departmentSource).toContain('if (!isUuid(body.headEmployeeId))');
  });

  it('guards shared office ids and parent references before UUID-backed queries', () => {
    expect(officeSource).toContain('const UUID_PATTERN =');
    expect(officeSource).toContain("if (!isUuid(id)) {");
    expect(officeSource).toContain("{ error: 'Office not found.' }, { status: 404 }");
    expect(officeSource).toContain("if (!isUuid(parentId)) return 'The selected parent office does not belong to this tenant.';");
  });

  it('enforces normalized tenant-local department and office code uniqueness in the database', () => {
    expect(migrationSource).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_departments_tenant_code_normalized');
    expect(migrationSource).toContain('ON departments (tenant_id, upper(btrim(code)))');
    expect(migrationSource).toContain('CREATE UNIQUE INDEX IF NOT EXISTS uq_offices_tenant_code_normalized');
    expect(migrationSource).toContain('ON offices (tenant_id, upper(btrim(code)))');
  });

  it('maps concurrent code winners to controlled 409 responses', () => {
    expect(departmentSource).toContain("details.code === '23505'");
    expect(departmentSource).toContain('uq_departments_tenant_code_normalized');
    expect(departmentSource).toContain('This organisation unit code is already used in this tenant. Refresh and try again.');
    expect(officeSource).toContain("details.code === '23505'");
    expect(officeSource).toContain('uq_offices_tenant_code_normalized');
    expect(officeSource).toContain('This office code is already used in this tenant. Refresh and try again.');
  });
});
