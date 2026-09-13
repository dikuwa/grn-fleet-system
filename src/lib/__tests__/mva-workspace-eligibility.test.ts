import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/app/(dashboard)/dashboard/trips/incidents/page.tsx',
  ),
  'utf8',
);

describe('MVA workspace eligibility', () => {
  it('includes tenant-configured MVA categories and serious accident compatibility cases', () => {
    expect(source).toContain('eq(incidentCategories.requiresMvaForm, true)');
    expect(source).toContain("inArray(tripIncidents.incidentType, ['accident', 'accident_collision'])");
    expect(source).toContain("inArray(tripIncidents.severity, ['serious', 'critical'])");
  });

  it('counts pending technical clearance with the shared vehicle-restriction policy', () => {
    expect(source).toContain("import { incidentRequiresVehicleRestriction } from '@/lib/incidents/incident-safety';");
    expect(source).toContain('incidentRequiresVehicleRestriction({');
    expect(source).toContain('vehicleDamage: row.vehicleDamage');
    expect(source).toContain('vehicleSafe: row.vehicleSafe');
  });
});
