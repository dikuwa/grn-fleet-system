import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection sync identifier normalization', () => {
  it('converts malformed percent-encoding into the existing controlled 400 boundary', () => {
    const route = source('src/app/api/inspections/sync/[clientSyncId]/route.ts');

    expect(route).toContain('function normalizeSyncId(value: string)');
    expect(route).toContain("return decodeURIComponent(value || '').trim();");
    expect(route).toContain('return null;');
    expect(route).toContain('const syncId = normalizeSyncId(clientSyncId);');
    expect(route).toContain("NextResponse.json({ error: 'Invalid inspection sync identifier' }, { status: 400 })");
  });

  it('preserves tenant and creating-inspector recovery scoping', () => {
    const route = source('src/app/api/inspections/sync/[clientSyncId]/route.ts');

    expect(route).toContain('eq(vehicleInspections.tenantId, session.tenantId)');
    expect(route).toContain('eq(vehicleInspections.inspectorUserId, session.user.id)');
    expect(route).toContain('eq(vehicleInspections.clientSyncId, syncId)');
  });
});
