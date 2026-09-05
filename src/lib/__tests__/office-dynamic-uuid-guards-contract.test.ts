import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/offices/[id]/route.ts'),
  'utf8',
);
const patchSource = source.slice(
  source.indexOf('export async function PATCH'),
  source.indexOf('export async function DELETE'),
);
const deleteSource = source.slice(source.indexOf('export async function DELETE'));

describe('office dynamic UUID guards', () => {
  it('guards PATCH route ids before forwarding into the UUID-backed shared route', () => {
    const paramsIndex = patchSource.indexOf('const { id } = await params');
    const bodyIndex = patchSource.indexOf('const body = await request.json()');
    const guardIndex = patchSource.indexOf('if (!UUID_PATTERN.test(id))');
    const forwardIndex = patchSource.indexOf('return patchOffice(');

    expect(source).toContain('const UUID_PATTERN =');
    expect(bodyIndex).toBeGreaterThan(paramsIndex);
    expect(guardIndex).toBeGreaterThan(bodyIndex);
    expect(forwardIndex).toBeGreaterThan(guardIndex);
    expect(patchSource).toContain("{ error: 'Office not found.' }, { status: 404 }");
  });

  it('keeps DELETE authorization ahead of the UUID guard and database access behind it', () => {
    const authIndex = deleteSource.indexOf('const auth = await requireRequestAuth(request)');
    const permissionIndex = deleteSource.indexOf(
      'requirePermission(auth.session, Permissions.TENANT_MANAGE)',
    );
    const guardIndex = deleteSource.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = deleteSource.indexOf('const db = getDb()');
    const lookupIndex = deleteSource.indexOf('.from(offices)');

    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(lookupIndex).toBeGreaterThan(dbIndex);
    expect(deleteSource).toContain("{ error: 'Office not found.' }, { status: 404 }");
  });
});
