import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/storage/check-dup/route.ts'),
  'utf8',
);

describe('storage dedup tenant scope contract', () => {
  it('derives the object namespace only from the authenticated session tenant', () => {
    expect(routeSource).toContain('const tenantPrefix = `tenant/${session.tenantId}`;');
    expect(routeSource).not.toContain('const targetTenantId = tenantId || session.tenantId;');
    expect(routeSource).not.toContain('tenantId?: string;');
    expect(routeSource).not.toContain('sha256, category, tenantId');
  });

  it('keeps incident evidence non-deduplicated while preserving ordinary tenant dedup', () => {
    expect(routeSource).toContain("if (category === 'trip-incident')");
    expect(routeSource).toContain('data: { keys: [], existing: false }');
    expect(routeSource).toContain('const hashPrefix = sha256.slice(0, 16);');
    expect(routeSource).toContain('const files = await listFiles(searchPrefix);');
  });
});
