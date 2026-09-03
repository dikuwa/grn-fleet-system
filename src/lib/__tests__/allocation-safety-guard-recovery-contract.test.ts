import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration0085 = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0085_allocation_vehicle_safety_guard.sql'),
  'utf8',
);
const migration0096 = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0096_allocation_lifecycle_integrity.sql'),
  'utf8',
);
const migration0112 = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0112_restore_allocation_vehicle_safety_guard.sql'),
  'utf8',
);
const availabilityRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/vehicles/[id]/availability/route.ts'),
  'utf8',
);
const allocationRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/allocations/route.ts'),
  'utf8',
);

describe('allocation vehicle safety guard recovery', () => {
  it('documents the later function replacement that dropped 0085 safety clauses', () => {
    expect(migration0085).toContain('CREATE OR REPLACE FUNCTION guard_vehicle_allocation_concurrency()');
    expect(migration0085).toContain("RAISE EXCEPTION 'allocation_vehicle_not_available'");
    expect(migration0085).toContain("RAISE EXCEPTION 'allocation_vehicle_blocking_defect'");

    expect(migration0096).toContain('CREATE OR REPLACE FUNCTION guard_vehicle_allocation_concurrency()');
    expect(migration0096).not.toContain("RAISE EXCEPTION 'allocation_vehicle_not_available'");
    expect(migration0096).not.toContain("RAISE EXCEPTION 'allocation_vehicle_blocking_defect'");
  });

  it('combines request lifecycle serialization with canonical vehicle-row safety serialization', () => {
    expect(migration0112).toContain("pg_advisory_xact_lock(hashtextextended('allocation-request:'");
    expect(migration0112).toContain('FROM transport_requests');
    expect(migration0112).toContain("RAISE EXCEPTION 'allocation_request_not_allocatable:%'");

    expect(migration0112).toContain("pg_advisory_xact_lock(hashtextextended('allocation-vehicle:'");
    expect(migration0112).toContain('FROM vehicles v');
    expect(migration0112).toContain('FOR UPDATE;');
    expect(migration0112).toContain("RAISE EXCEPTION 'allocation_vehicle_not_available'");
  });

  it('keeps unresolved blocking defects as an independent database invariant', () => {
    expect(migration0112).toContain('FROM vehicle_defects vd');
    expect(migration0112).toContain('vd.is_blocking = true');
    expect(migration0112).toContain('vd.resolved_at IS NULL');
    expect(migration0112).toContain("RAISE EXCEPTION 'allocation_vehicle_blocking_defect'");
  });

  it('preserves request, vehicle and driver overlap serialization', () => {
    expect(migration0112).toContain("RAISE EXCEPTION 'allocation_request_already_live'");
    expect(migration0112).toContain("RAISE EXCEPTION 'allocation_vehicle_overlap'");
    expect(migration0112).toContain("pg_advisory_xact_lock(hashtextextended('allocation-driver:'");
    expect(migration0112).toContain("RAISE EXCEPTION 'allocation_driver_overlap'");
  });

  it('does not advertise provisional vehicles when allocation requires canonical available status', () => {
    expect(allocationRoute).toContain("if (vehicle.status !== 'available')");
    expect(availabilityRoute).toContain("if (vehicle.status !== 'available')");
    expect(availabilityRoute).toContain('Only available vehicles can be allocated.');
    expect(availabilityRoute).not.toContain("const availableStatuses = ['available', 'provisional']");
  });
});
