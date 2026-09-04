import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0113_vehicle_active_licence_uniqueness.sql'),
  'utf8',
);
const createRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/route.ts'),
  'utf8',
);
const updateRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/route.ts'),
  'utf8',
);
const importRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/import/route.ts'),
  'utf8',
);

describe('active vehicle licence uniqueness contract', () => {
  it('enforces tenant-scoped normalized uniqueness for active fleet records', () => {
    expect(migrationSource).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_tenant_active_licence_normalized',
    );
    expect(migrationSource).toContain(
      'ON vehicles (tenant_id, lower(btrim(licence_number)))',
    );
    expect(migrationSource).toContain('WHERE is_active = true');
  });

  it('uses the same normalization for create, edit and import identity matching', () => {
    expect(createRouteSource).toContain(
      'lower(btrim(${vehicles.licenceNumber})) = lower(btrim(${licenceNumber}))',
    );
    expect(updateRouteSource).toContain(
      'lower(btrim(${vehicles.licenceNumber})) = lower(btrim(${requestedLicenceNumber}))',
    );
    expect(importRouteSource).toContain('function normalizeLicenceNumber(value: string)');
    expect(importRouteSource).toContain(
      'sql<string>`lower(btrim(${vehicles.licenceNumber}))`',
    );
    expect(importRouteSource).toContain(
      'sql<boolean>`lower(btrim(${vehicles.licenceNumber})) = ${normalizedLicenceNumber}`',
    );

    for (const routeSource of [createRouteSource, updateRouteSource, importRouteSource]) {
      expect(routeSource).toContain('eq(vehicles.tenantId,');
      expect(routeSource).toContain('eq(vehicles.isActive, true)');
    }
  });

  it('maps database uniqueness winners to controlled conflicts or row errors', () => {
    for (const routeSource of [createRouteSource, updateRouteSource]) {
      expect(routeSource).toContain("details.code === '23505'");
      expect(routeSource).toContain('uq_vehicles_tenant_active_licence_normalized');
      expect(routeSource).toContain('{ status: 409 }');
    }
    expect(createRouteSource).toContain(
      'An active vehicle with this licence number already exists in your fleet.',
    );
    expect(updateRouteSource).toContain(
      'Another active vehicle already uses this licence number.',
    );
    expect(importRouteSource).toContain("details.code === '23505'");
    expect(importRouteSource).toContain('ACTIVE_LICENCE_UNIQUE_INDEX');
    expect(importRouteSource).toContain(
      'An active vehicle with this licence number already exists. Review duplicate rows or concurrent fleet changes.',
    );
  });
});
