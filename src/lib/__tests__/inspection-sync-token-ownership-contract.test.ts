import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection offline sync token ownership', () => {
  it('keeps the tenant-wide sync uniqueness boundary but refuses cross-inspector idempotent replay', () => {
    const schema = source('src/db/schema/trips.ts');
    const service = source('src/lib/inspection-service.ts');

    expect(schema).toContain(
      "uniqueIndex('uq_vehicle_inspections_tenant_sync').on(table.tenantId, table.clientSyncId)",
    );
    expect(service).toContain('eq(vehicleInspections.tenantId, tenantId)');
    expect(service).toContain('eq(vehicleInspections.clientSyncId, input.clientSyncId)');

    const ownerGuard = "if (existing.inspectorUserId !== userId) {\n        fail('Inspection sync identifier is already in use', 409);\n      }";
    expect(service.split(ownerGuard)).toHaveLength(3);
  });

  it('preserves same-inspector retry recovery both before mutation and after uniqueness races', () => {
    const service = source('src/lib/inspection-service.ts');
    const firstLookup = service.indexOf('if (input.clientSyncId) {');
    const mutation = service.indexOf('await runAtomicMutations');
    const raceRecovery = service.indexOf("code === '23505' || code === '23514'");

    expect(firstLookup).toBeGreaterThan(-1);
    expect(mutation).toBeGreaterThan(firstLookup);
    expect(raceRecovery).toBeGreaterThan(mutation);
    expect(service.slice(firstLookup, mutation)).toContain('idempotent: true');
    expect(service.slice(raceRecovery)).toContain('idempotent: true');
  });

  it('matches the dedicated recovery endpoint inspector scope', () => {
    const syncRoute = source('src/app/api/inspections/sync/[clientSyncId]/route.ts');

    expect(syncRoute).toContain('eq(vehicleInspections.tenantId, session.tenantId)');
    expect(syncRoute).toContain('eq(vehicleInspections.inspectorUserId, session.user.id)');
    expect(syncRoute).toContain('eq(vehicleInspections.clientSyncId, syncId)');
  });
});
