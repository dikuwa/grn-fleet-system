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

  it('uses the same normalization for create and edit duplicate pre-checks', () => {
    expect(createRouteSource).toContain(
      'lower(btrim(${vehicles.licenceNumber})) = lower(btrim(${licenceNumber}))',
    );
    expect(updateRouteSource).toContain(
      'lower(btrim(${vehicles.licenceNumber})) = lower(btrim(${requestedLicenceNumber}))',
    );
    expect(createRouteSource).toContain('eq(vehicles.tenantId, session.tenantId)');
    expect(updateRouteSource).toContain('eq(vehicles.tenantId, session.tenantId)');
    expect(createRouteSource).toContain('eq(vehicles.isActive, true)');
    expect(updateRouteSource).toContain('eq(vehicles.isActive, true)');
  });

  it('maps database uniqueness winners to controlled conflicts on create and edit', () => {
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
  });
});
