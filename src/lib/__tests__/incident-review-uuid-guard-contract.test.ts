import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const reviewRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/incidents/[id]/review/route.ts'),
  'utf8',
);

describe('incident review UUID guard contract', () => {
  it('rejects malformed incident ids after authorization but before database access', () => {
    expect(reviewRoute).toContain('const UUID_PATTERN =');
    expect(reviewRoute).toContain('if (!UUID_PATTERN.test(id))');
    expect(reviewRoute).toContain("{ error: 'Incident ID is invalid' }");
    expect(reviewRoute).toContain('{ status: 400 }');

    const permissionIndex = reviewRoute.indexOf('const permission = await requireAnyPermission');
    const guardIndex = reviewRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = reviewRoute.indexOf('const db = getDb()');

    expect(permissionIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps direct SQL uuid casts behind the route guard', () => {
    const guardIndex = reviewRoute.indexOf('if (!UUID_PATTERN.test(id))');
    expect(reviewRoute).toContain('${id}::uuid');
    expect(reviewRoute.indexOf('${id}::uuid')).toBeGreaterThan(guardIndex);
  });
});
