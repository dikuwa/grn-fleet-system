import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const createRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/route.ts'),
  'utf8',
);
const importRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/import/route.ts'),
  'utf8',
);

describe('vehicle entitlement concurrency contract', () => {
  it('serializes interactive and import capacity claims with the same tenant lock', () => {
    for (const source of [createRouteSource, importRouteSource]) {
      expect(source).toContain('pg_advisory_xact_lock(hashtextextended');
      expect(source).toContain('fleet-vehicle-entitlement:');
      expect(source).toContain("checkEntitlement(");
      expect(source).toContain("'vehicles'");
    }
  });

  it('recounts capacity inside the interactive create transaction before insert', () => {
    const transactionStart = createRouteSource.indexOf('db.transaction(async (tx) =>');
    const lockIndex = createRouteSource.indexOf('pg_advisory_xact_lock', transactionStart);
    const countIndex = createRouteSource.indexOf('.select({ total: count() })', lockIndex);
    const insertIndex = createRouteSource.indexOf('.insert(vehicles)', countIndex);
    expect(transactionStart).toBeGreaterThan(-1);
    expect(lockIndex).toBeGreaterThan(transactionStart);
    expect(countIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(countIndex);
    expect(createRouteSource).toContain('VEHICLE_ENTITLEMENT_CONFLICT');
    expect(createRouteSource).toContain('{ status: 409 }');
  });

  it('recounts only in the new-vehicle import transaction and preserves row-level failure', () => {
    const newVehicleBranch = importRouteSource.indexOf('} else {');
    const lockIndex = importRouteSource.indexOf('pg_advisory_xact_lock', newVehicleBranch);
    const countIndex = importRouteSource.indexOf('.select({ total: count() })', lockIndex);
    const insertIndex = importRouteSource.indexOf('.insert(vehicles)', countIndex);
    expect(lockIndex).toBeGreaterThan(newVehicleBranch);
    expect(countIndex).toBeGreaterThan(lockIndex);
    expect(insertIndex).toBeGreaterThan(countIndex);
    expect(importRouteSource).toContain('rowError.message.startsWith(VEHICLE_ENTITLEMENT_CONFLICT)');
    expect(importRouteSource).toContain('rowError.message.slice(VEHICLE_ENTITLEMENT_CONFLICT.length)');
  });
});
