import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const internalReturn = readFileSync('src/app/api/trips/[id]/return/route.ts', 'utf8');
const externalReturn = readFileSync('src/app/api/trips/[id]/external-return/route.ts', 'utf8');

describe('trip return pending driver-handover contract', () => {
  it('serializes internal return against the current allocation driver/version', () => {
    expect(internalReturn).toContain('AND va.version = ${trip.allocationVersion}');
    expect(internalReturn).toContain('AND va.driver_employee_id = ${employee.id}::uuid');
    expect(internalReturn).toContain("AND t.status IN ('in_progress', 'return_due')");
  });

  it('atomically closes an unacknowledged relief proposal when the current driver returns', () => {
    expect(internalReturn).toContain('pending_handover_cancel AS (');
    expect(internalReturn).toContain("SET driver_type = 'relief_cancelled'");
    expect(internalReturn).toContain("AND tad.driver_type = 'relief'");
    expect(internalReturn).toContain('AND tad.acknowledged_at IS NULL');
    expect(internalReturn).toContain('AND EXISTS (SELECT 1 FROM trip_claim)');
  });

  it('resets the outgoing segment and records amendment plus audit evidence when auto-cancelling', () => {
    expect(internalReturn).toContain('outgoing_segment_reset AS (');
    expect(internalReturn).toContain('SET handover_odometer = NULL');
    expect(internalReturn).toContain("'driver_handover_cancelled'");
    expect(internalReturn).toContain("'cancelled_on_return'");
    expect(internalReturn).toContain("'trip_driver_handover_cancelled_on_return'");
    expect(internalReturn).toContain("'Trip returned before relief-driver acknowledgement'");
  });

  it('fails closed if pending-handover cleanup cannot be persisted with the return', () => {
    expect(internalReturn).toContain(
      '(SELECT count(*) FROM pending_handover_cancel) = (SELECT count(*) FROM outgoing_segment_reset)',
    );
    expect(internalReturn).toContain(
      '(SELECT count(*) FROM pending_handover_cancel) = (SELECT count(*) FROM handover_amendment_insert)',
    );
    expect(internalReturn).toContain(
      '(SELECT count(*) FROM pending_handover_cancel) = (SELECT count(*) FROM handover_audit_insert)',
    );
    expect(internalReturn).toContain("'atomic_trip_return_failed_'");
  });

  it('does not apply internal employee handover semantics to external-driver return', () => {
    expect(externalReturn).toContain('AND va.driver_employee_id IS NULL');
    expect(externalReturn).not.toContain('pending_handover_cancel AS (');
  });
});
