import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/dashboard/inspections/page.tsx'),
  'utf8',
);

describe('inspection search pagination count query', () => {
  it('joins vehicles before reusing the vehicle search predicate in the total count query', () => {
    const totalQueryIndex = source.indexOf(".select({ count: sql<number>`count(*)` })");
    const joinIndex = source.indexOf(
      '.leftJoin(vehicles, eq(vehicleInspections.vehicleId, vehicles.id))',
      totalQueryIndex,
    );
    const whereIndex = source.indexOf('.where(where)', totalQueryIndex);

    expect(totalQueryIndex).toBeGreaterThan(-1);
    expect(joinIndex).toBeGreaterThan(totalQueryIndex);
    expect(whereIndex).toBeGreaterThan(joinIndex);
  });
});
