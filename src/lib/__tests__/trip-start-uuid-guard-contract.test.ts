import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const startRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/start/route.ts'),
  'utf8',
);

describe('trip start UUID guard contract', () => {
  it('rejects malformed trip ids after authorization and before database access', () => {
    expect(startRoute).toContain('const UUID_PATTERN =');
    expect(startRoute).toContain('if (!UUID_PATTERN.test(id))');
    expect(startRoute).toContain("{ error: 'Trip ID is invalid' }");
    expect(startRoute).toContain('{ status: 400 }');

    const permissionIndex = startRoute.indexOf('const permCheck = await requireAnyPermission');
    const guardIndex = startRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = startRoute.indexOf('const db = getDb()');

    expect(permissionIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps direct trip uuid casts behind the route guard', () => {
    const guardIndex = startRoute.indexOf('if (!UUID_PATTERN.test(id))');
    expect(startRoute).toContain('${id}::uuid');
    expect(startRoute.indexOf('${id}::uuid')).toBeGreaterThan(guardIndex);
  });
});
