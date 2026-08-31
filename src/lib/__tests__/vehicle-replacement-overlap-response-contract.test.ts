import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = readFileSync('src/app/api/allocations/[id]/replace/route.ts', 'utf8');
const allocationGuard = readFileSync('src/db/migrations/0102_driver_handover_overlap_response.sql', 'utf8');

describe('vehicle replacement overlap response contract', () => {
  it('keeps the central allocation trigger as the authoritative vehicle-overlap race boundary', () => {
    expect(allocationGuard).toContain("pg_advisory_xact_lock(hashtextextended('allocation-vehicle:'");
    expect(allocationGuard).toContain("RAISE EXCEPTION 'allocation_vehicle_overlap'");
    expect(allocationGuard).toContain("USING ERRCODE = '23P01'");
  });

  it('maps a database vehicle-overlap race to an HTTP 409 response', () => {
    expect(route).toContain("dbError.code === '23P01'");
    expect(route).toContain("diagnostic.includes('allocation_vehicle_overlap')");
    expect(route).toContain('while this replacement was being saved');
    expect(route).toContain('{ status: 409 }');
  });

  it('preserves existing VehicleReplaceError handling before database fallback classification', () => {
    expect(route).toContain('error instanceof VehicleReplaceError');
    expect(route.indexOf('error instanceof VehicleReplaceError')).toBeLessThan(route.indexOf("dbError.code === '23P01'"));
  });
});
