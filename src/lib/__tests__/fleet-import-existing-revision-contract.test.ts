import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/import/route.ts'),
  'utf8',
);

describe('fleet import existing-vehicle lifecycle guard', () => {
  it('does not let imports change an existing vehicle operational status', () => {
    expect(routeSource).toContain('importedStatus !== existing.status');
    expect(routeSource).toContain(
      'Existing vehicle status cannot be changed by bulk import. Use the dedicated allocation, maintenance, return-to-service, or decommission workflow.',
    );
    expect(routeSource).toContain('status: existing.status');
  });

  it('claims the exact current vehicle revision before an existing-row import commits', () => {
    expect(routeSource).toContain('updatedAt: vehicles.updatedAt');
    expect(routeSource).toContain('eq(vehicles.status, existing.status)');
    expect(routeSource).toContain("date_trunc('milliseconds', ${vehicles.updatedAt})");
    expect(routeSource).toContain('${existing.updatedAt.toISOString()}::timestamptz');
    expect(routeSource).toContain('.returning({ id: vehicles.id })');
    expect(routeSource).toContain('if (!updated) throw new Error(EXISTING_VEHICLE_IMPORT_CONFLICT);');
  });

  it('records imported odometer increases as immutable evidence atomically with the vehicle update', () => {
    const transactionStart = routeSource.indexOf('await db.transaction(async (tx) => {');
    const updateStart = routeSource.indexOf('.update(vehicles)', transactionStart);
    const odometerStart = routeSource.indexOf('await tx.insert(vehicleOdometerEvents).values({', updateStart);
    const committedRowStart = routeSource.indexOf('await tx.insert(importRows).values({', odometerStart);
    const transactionEnd = routeSource.indexOf('\n          });', committedRowStart);

    expect(routeSource).toContain('nextOdometer > existing.currentOdometer');
    expect(routeSource).toContain("source: 'manual_correction'");
    expect(routeSource).toContain('recordedByUserId: userId');
    expect(updateStart).toBeGreaterThan(transactionStart);
    expect(odometerStart).toBeGreaterThan(updateStart);
    expect(committedRowStart).toBeGreaterThan(odometerStart);
    expect(transactionEnd).toBeGreaterThan(committedRowStart);
  });

  it('keeps new vehicle creation and committed import evidence in one transaction', () => {
    const newVehicleBranch = routeSource.indexOf('} else {');
    const transactionStart = routeSource.indexOf('await db.transaction(async (tx) => {', newVehicleBranch);
    const insertVehicle = routeSource.indexOf('.insert(vehicles)', transactionStart);
    const insertEvidence = routeSource.indexOf('await tx.insert(importRows).values({', insertVehicle);

    expect(transactionStart).toBeGreaterThan(newVehicleBranch);
    expect(insertVehicle).toBeGreaterThan(transactionStart);
    expect(insertEvidence).toBeGreaterThan(insertVehicle);
  });

  it('turns a lost existing-row race into a row-level import error', () => {
    expect(routeSource).toContain("const EXISTING_VEHICLE_IMPORT_CONFLICT = 'existing_vehicle_import_conflict';");
    expect(routeSource).toContain(
      'Vehicle changed while this import row was being applied. Review the latest fleet record and retry this row.',
    );
    expect(routeSource).toContain('isCommitted: false');
  });
});
