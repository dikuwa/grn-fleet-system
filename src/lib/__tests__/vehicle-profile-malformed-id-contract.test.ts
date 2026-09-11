import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/route.ts'),
  'utf8',
);

describe('vehicle profile malformed-id guards', () => {
  it('guards GET vehicle ids after authorization and before database access', () => {
    const getStart = source.indexOf('export async function GET');
    const patchStart = source.indexOf('export async function PATCH');
    const getSource = source.slice(getStart, patchStart);

    const authIndex = getSource.indexOf('const auth = await requireRequestAuth(req)');
    const permissionIndex = getSource.indexOf('Permissions.VEHICLE_VIEW');
    const guardIndex = getSource.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = getSource.indexOf('const db = getDb();');

    expect(source).toContain('const UUID_PATTERN =');
    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(getSource.slice(guardIndex, dbIndex)).toContain("{ error: 'Vehicle ID is invalid' }");
    expect(getSource.slice(guardIndex, dbIndex)).toContain('{ status: 400 }');
  });

  it('guards PATCH vehicle ids after authorization and before database access', () => {
    const patchStart = source.indexOf('export async function PATCH');
    const patchSource = source.slice(patchStart);

    const authIndex = patchSource.indexOf('const auth = await requireRequestAuth(req)');
    const permissionIndex = patchSource.indexOf('Permissions.VEHICLE_UPDATE');
    const guardIndex = patchSource.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = patchSource.indexOf('const db = getDb();');

    expect(permissionIndex).toBeGreaterThan(authIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(patchSource.slice(guardIndex, dbIndex)).toContain("{ error: 'Vehicle ID is invalid' }");
    expect(patchSource.slice(guardIndex, dbIndex)).toContain('{ status: 400 }');
  });

  it('rejects malformed category ids before the tenant-scoped category lookup', () => {
    const guardIndex = source.indexOf(
      'if (body.categoryId && !UUID_PATTERN.test(String(body.categoryId)))',
    );
    const queryIndex = source.indexOf('const [category] = await db', guardIndex);
    const guardBlock = source.slice(guardIndex, queryIndex);

    expect(guardIndex).toBeGreaterThan(-1);
    expect(queryIndex).toBeGreaterThan(guardIndex);
    expect(guardBlock).toContain("{ error: 'Vehicle category not found in your tenant' }");
    expect(guardBlock).toContain('{ status: 422 }');
    expect(source.slice(queryIndex)).toContain('eq(vehicleCategories.tenantId, session.tenantId)');
  });
});
