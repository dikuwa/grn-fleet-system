import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const resolveRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/defects/[id]/resolve/route.ts'),
  'utf8',
);

describe('defect resolve UUID guard contract', () => {
  it('rejects malformed defect ids before database access', () => {
    expect(resolveRoute).toContain('const UUID_PATTERN =');
    expect(resolveRoute).toContain('if (!UUID_PATTERN.test(id))');
    expect(resolveRoute).toContain("{ error: 'Defect ID is invalid' }");
    expect(resolveRoute).toContain('{ status: 400 }');

    const guardIndex = resolveRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = resolveRoute.indexOf('const db = getDb()');
    expect(guardIndex).toBeGreaterThan(-1);
    expect(dbIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(dbIndex);
  });

  it('keeps database UUID casts behind the route guard', () => {
    expect(resolveRoute).toContain('${id}::uuid');
    expect(resolveRoute.indexOf('${id}::uuid')).toBeGreaterThan(
      resolveRoute.indexOf('if (!UUID_PATTERN.test(id))'),
    );
  });
});
