import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/route.ts'),
  'utf8',
);

describe('inspection confirmed allocation guard', () => {
  it('requires the submitted trip and vehicle to resolve through the authoritative allocation', () => {
    expect(source).toContain('tripAuthorities, trips, vehicleAllocations');
    expect(source).toContain('eq(vehicleAllocations.id, trips.allocationId)');
    expect(source).toContain('eq(vehicleAllocations.requestId, trips.requestId)');
    expect(source).toContain('eq(vehicleAllocations.vehicleId, trips.vehicleId)');
    expect(source).toContain('eq(trips.id, tripId)');
    expect(source).toContain('eq(trips.vehicleId, vehicleId)');
    expect(source).toContain('eq(trips.tenantId, session.tenantId)');
  });

  it('rejects a non-confirmed allocation before inspection service execution', () => {
    const allocationStateIndex = source.indexOf("if (allocation.state !== 'confirmed')");
    const conflictIndex = source.indexOf(
      "Inspection requires the trip current vehicle allocation to be confirmed.",
    );
    const serviceIndex = source.indexOf('const result = await completeOfficialInspection({');

    expect(allocationStateIndex).toBeGreaterThan(-1);
    expect(conflictIndex).toBeGreaterThan(allocationStateIndex);
    expect(source).toContain('{ status: 409 }');
    expect(serviceIndex).toBeGreaterThan(conflictIndex);
  });
});
