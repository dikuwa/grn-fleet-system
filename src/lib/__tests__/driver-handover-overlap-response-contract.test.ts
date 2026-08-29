import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const handoverRoute = readFileSync('src/app/api/trips/[id]/driver-handover/route.ts', 'utf8');
const migration = readFileSync('src/db/migrations/0102_driver_handover_overlap_response.sql', 'utf8');

describe('relief-driver handover overlap response contract', () => {
  it('keeps the latest allocation lifecycle guard as the race boundary', () => {
    expect(migration).toContain('guard_vehicle_allocation_concurrency');
    expect(migration).toContain('enters_live_reservation');
    expect(migration).toContain('FROM transport_requests');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain("'transport_review'");
    expect(migration).toContain("'release_pending'");
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('allocation-request:'");
    expect(migration).toContain("pg_advisory_xact_lock(hashtextextended('allocation-driver:'");
    expect(migration).toContain('driver_employee_id = NEW.driver_employee_id');
    expect(migration).toContain('start_at < NEW.end_at');
    expect(migration).toContain('end_at > NEW.start_at');
    expect(migration).toContain("RAISE EXCEPTION 'allocation_driver_overlap'");
  });

  it('tags only a pending relief-driver transfer with the handover atomic marker', () => {
    expect(migration).toContain("TG_OP = 'UPDATE'");
    expect(migration).toContain('OLD.driver_employee_id IS DISTINCT FROM NEW.driver_employee_id');
    expect(migration).toContain("t.status IN ('in_progress', 'return_due')");
    expect(migration).toContain("tad.driver_type = 'relief'");
    expect(migration).toContain('tad.acknowledged_at IS NULL');
    expect(migration).toContain(
      "RAISE EXCEPTION 'atomic_driver_handover_initiate_failed allocation_driver_overlap'",
    );
  });

  it('uses the route existing atomic-conflict branch to return 409', () => {
    expect(handoverRoute).toContain("String(error).includes('atomic_driver_handover_initiate_failed')");
    expect(handoverRoute).toContain('{ status: 409 }');
  });

  it('keeps friendly handover overlap checks aligned with the database live-state and time-window rule', () => {
    expect(handoverRoute).toContain(
      "const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed', 'issued'] as const;",
    );
    expect(handoverRoute).toContain('startAt: vehicleAllocations.startAt');
    expect(handoverRoute).toContain('endAt: vehicleAllocations.endAt');
    expect(handoverRoute).toContain('lt(vehicleAllocations.startAt, context.endAt)');
    expect(handoverRoute).toContain('gt(vehicleAllocations.endAt, context.startAt)');
    expect(handoverRoute).toContain('another overlapping live allocation');
  });
});