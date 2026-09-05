import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/roles/route.ts'),
  'utf8',
);

describe('admin role revision integrity contract', () => {
  it('returns existing role-not-found surface for malformed role IDs before database access', () => {
    const required = source.indexOf('Role ID is required');
    const guard = source.indexOf('if (!UUID_PATTERN.test(roleId))', required);
    const notFound = source.indexOf('Role not found', guard);
    const db = source.indexOf('const db = getDb()', guard);

    expect(guard).toBeGreaterThan(required);
    expect(notFound).toBeGreaterThan(guard);
    expect(db).toBeGreaterThan(notFound);
  });

  it('normalizes the role revision to milliseconds for optimistic claims', () => {
    const helper = source.indexOf('function roleRevisionMatches');
    const normalized = source.indexOf("date_trunc('milliseconds'", helper);
    const claim = source.indexOf('roleRevisionMatches(existing.updatedAt)', normalized);

    expect(helper).toBeGreaterThan(-1);
    expect(normalized).toBeGreaterThan(helper);
    expect(claim).toBeGreaterThan(normalized);
  });

  it('claims the reviewed role before replacing permissions', () => {
    const transaction = source.indexOf('await db.transaction(async (tx) => {', source.indexOf('const hasMutation'));
    const claim = source.indexOf('.update(roles)', transaction);
    const returning = source.indexOf('.returning({ id: roles.id })', claim);
    const lost = source.indexOf('if (!claimed)', returning);
    const deletePermissions = source.indexOf('tx.delete(rolePermissions)', lost);

    expect(transaction).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(transaction);
    expect(returning).toBeGreaterThan(claim);
    expect(lost).toBeGreaterThan(returning);
    expect(deletePermissions).toBeGreaterThan(lost);
  });

  it('maps a lost role revision to controlled 409 before successful audit', () => {
    const conflict = source.indexOf('error.message === ROLE_UPDATE_CONFLICT');
    const status = source.indexOf('{ status: 409 }', conflict);
    expect(conflict).toBeGreaterThan(-1);
    expect(status).toBeGreaterThan(conflict);
  });
});
