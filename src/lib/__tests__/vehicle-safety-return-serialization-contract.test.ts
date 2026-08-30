import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'src/db/migrations/0105_vehicle_safety_return_serialization.sql',
  'utf8',
);
const defectResolveRoute = readFileSync('src/app/api/defects/[id]/resolve/route.ts', 'utf8');
const incidentReviewRoute = readFileSync('src/app/api/incidents/[id]/review/route.ts', 'utf8');

describe('vehicle safety evidence vs return-to-service serialization', () => {
  it('uses the vehicle row as the shared lock boundary for unresolved blocking defects', () => {
    expect(migration).toContain('lock_vehicle_for_blocking_defect');
    expect(migration).toContain('FROM vehicles');
    expect(migration).toContain('WHERE id = NEW.vehicle_id');
    expect(migration).toContain('FOR UPDATE');
    expect(migration).toContain("status = 'maintenance'");
  });

  it('uses the same vehicle-row boundary for explicit safety incidents only', () => {
    expect(migration).toContain('lock_vehicle_for_safety_incident');
    expect(migration).toContain('FOR UPDATE OF v');
    expect(migration).toContain('NEW.vehicle_damage IS TRUE');
    expect(migration).toContain('NEW.vehicle_safe IS FALSE');
    expect(migration).toContain("NEW.severity = 'critical'");
    expect(migration).toContain("NEW.technical_clearance_status = 'cleared'");
    expect(migration).toContain('Unknown\n  -- vehicle condition (NULL) is intentionally non-blocking');
  });

  it('rechecks all live blockers after the availability update has claimed the vehicle row', () => {
    expect(migration).toContain('guard_vehicle_return_to_service');
    expect(migration).toContain('LANGUAGE plpgsql');
    expect(migration).toContain('VOLATILE');
    expect(migration).toContain("NEW.status IS DISTINCT FROM 'available'");
    expect(migration).toContain("d.is_blocking = true");
    expect(migration).toContain("t.status IN ('pending', 'in_progress', 'return_due', 'return_inspection', 'closure_review')");
    expect(migration).toContain('ti.vehicle_damage IS TRUE');
    expect(migration).toContain('ti.vehicle_safe IS FALSE');
    expect(migration).toContain("ti.technical_clearance_status <> 'cleared'");
    expect(migration).toContain('RETURN NULL');
  });

  it('preserves terminal vehicle statuses and lock ordering', () => {
    expect(migration).toContain("OLD.status IN ('written_off', 'decommissioned')");
    expect(migration).toContain("v_status NOT IN ('out_of_service', 'written_off', 'decommissioned', 'maintenance')");
    expect(migration).not.toContain('pg_advisory_xact_lock');
  });

  it('keeps existing callers fail-closed when the guarded availability update returns no row', () => {
    expect(defectResolveRoute).toContain('releasePending: defect.isBlocking && releasedCount !== 1');
    expect(incidentReviewRoute).toContain('atomic_vehicle_return_to_service_failed');
    expect(incidentReviewRoute).toContain("status: 409");
  });
});
