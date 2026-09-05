import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/admin/users/[id]/route.ts'),
  'utf8',
);

describe('admin user role UUID boundary guards', () => {
  it('preserves membership lookup before add-role validation and database role lookup', () => {
    const membership = source.indexOf("if (!membership) return NextResponse.json({ error: 'User not found in your organisation' }");
    const addRole = source.indexOf('if (addRoleId) {');
    const guard = source.indexOf('if (!UUID_PATTERN.test(String(addRoleId)))', addRole);
    const roleLookup = source.indexOf('.from(roles)', guard);

    expect(membership).toBeGreaterThan(-1);
    expect(addRole).toBeGreaterThan(membership);
    expect(guard).toBeGreaterThan(addRole);
    expect(roleLookup).toBeGreaterThan(guard);
  });

  it('reuses the existing scoped not-found surfaces before UUID-backed role queries', () => {
    const addRole = source.indexOf('if (addRoleId) {');
    const addGuard = source.indexOf('if (!UUID_PATTERN.test(String(addRoleId)))', addRole);
    const addNotFound = source.indexOf("{ error: 'Role not found' }", addGuard);
    const removeRole = source.indexOf('if (removeRoleId) {');
    const removeGuard = source.indexOf('if (!UUID_PATTERN.test(String(removeRoleId)))', removeRole);
    const removeNotFound = source.indexOf("{ error: 'Role assignment not found' }", removeGuard);
    const assignmentLookup = source.indexOf('.from(roleAssignments)', removeGuard);

    expect(addGuard).toBeGreaterThan(addRole);
    expect(addNotFound).toBeGreaterThan(addGuard);
    expect(removeGuard).toBeGreaterThan(removeRole);
    expect(removeNotFound).toBeGreaterThan(removeGuard);
    expect(assignmentLookup).toBeGreaterThan(removeNotFound);
  });
});
