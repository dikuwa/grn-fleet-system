import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const cancelRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/cancel/route.ts'),
  'utf8',
);

describe('trip cancel UUID guard contract', () => {
  it('rejects malformed trip ids after authorization and request validation but before database access', () => {
    expect(cancelRoute).toContain('const UUID_PATTERN =');
    expect(cancelRoute).toContain('if (!UUID_PATTERN.test(id))');
    expect(cancelRoute).toContain("{ error: 'Trip ID is invalid' }");
    expect(cancelRoute).toContain('{ status: 400 }');

    const permissionIndex = cancelRoute.indexOf('const permCheck = await requirePermission');
    const reasonValidationIndex = cancelRoute.indexOf('if (reason.length > 500)');
    const guardIndex = cancelRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = cancelRoute.indexOf('const db = getDb()');

    expect(permissionIndex).toBeGreaterThan(-1);
    expect(reasonValidationIndex).toBeGreaterThan(permissionIndex);
    expect(guardIndex).toBeGreaterThan(reasonValidationIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps cancellation SQL casts and concurrency conflict mapping behind the guard', () => {
    const guardIndex = cancelRoute.indexOf('if (!UUID_PATTERN.test(id))');
    expect(cancelRoute).toContain('${id}::uuid');
    expect(cancelRoute.indexOf('${id}::uuid')).toBeGreaterThan(guardIndex);
    expect(cancelRoute).toContain("String(error).includes('atomic_trip_cancel_failed')");
    expect(cancelRoute).toContain("{ status: 409 }");
  });
});
