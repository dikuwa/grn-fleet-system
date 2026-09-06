import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routePaths = [
  'src/app/api/platform/reset/[id]/route.ts',
  'src/app/api/platform/reset/[id]/dry-run/route.ts',
  'src/app/api/platform/reset/[id]/backup/route.ts',
  'src/app/api/platform/reset/[id]/execute/route.ts',
  'src/app/api/admin/data-reset/[id]/execute/route.ts',
];

describe('reset route UUID guards', () => {
  it.each(routePaths)('guards malformed reset ids before UUID database lookup: %s', (path) => {
    const source = readFileSync(resolve(process.cwd(), path), 'utf8');
    const params = source.indexOf('const { id } = await params');
    const guard = source.indexOf('if (!isUuid(id))', params);
    const db = source.indexOf('const db = getDb()', params);

    expect(source).toContain("import { isUuid } from '@/lib/uuid';");
    expect(params).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(params);
    expect(db).toBeGreaterThan(guard);
  });
});
