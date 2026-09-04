import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0113_vehicle_active_licence_uniqueness.sql'),
  'utf8',
);
const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/route.ts'),
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

  it('uses the same normalization for the friendly duplicate pre-check', () => {
    expect(routeSource).toContain(
      'lower(btrim(${vehicles.licenceNumber})) = lower(btrim(${licenceNumber}))',
    );
    expect(routeSource).toContain('eq(vehicles.tenantId, session.tenantId)');
    expect(routeSource).toContain('eq(vehicles.isActive, true)');
  });

  it('maps the database uniqueness winner to a controlled conflict', () => {
    expect(routeSource).toContain("details.code === '23505'");
    expect(routeSource).toContain('uq_vehicles_tenant_active_licence_normalized');
    expect(routeSource).toContain('An active vehicle with this licence number already exists in your fleet.');
    expect(routeSource).toContain('{ status: 409 }');
  });
});
