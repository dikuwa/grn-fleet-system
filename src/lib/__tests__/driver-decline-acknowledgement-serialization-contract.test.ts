import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const declineRoute = readFileSync(
  'src/app/api/trips/[id]/decline/route.ts',
  'utf8',
);
const acknowledgement = readFileSync(
  'src/lib/driver-acknowledgement.ts',
  'utf8',
);

describe('driver decline and acknowledgement serialization', () => {
  it('loads and claims the current allocation version before recording decline', () => {
    expect(declineRoute).toContain('allocationVersion: vehicleAllocations.version');
    expect(declineRoute).toContain('WITH allocation_claim AS');
    expect(declineRoute).toContain('SET version = version + 1');
    expect(declineRoute).toContain('AND va.version = ${context.allocationVersion}');
    expect(declineRoute).toContain('AND va.driver_employee_id = ${employee.id}::uuid');
    expect(declineRoute.indexOf('WITH allocation_claim AS')).toBeLessThan(
      declineRoute.indexOf('authority_claim AS'),
    );
  });

  it('re-proves pending unissued unacknowledged trip and acknowledgement-pending request state atomically', () => {
    expect(declineRoute).toContain("AND t.status = 'pending'");
    expect(declineRoute).toContain('AND t.issued_at IS NULL');
    expect(declineRoute).toContain('AND t.driver_acknowledged_at IS NULL');
    expect(declineRoute).toContain("AND tr.status = 'driver_acknowledgement_pending'");
    expect(declineRoute).toContain('AND tr.assigned_driver_employee_id = ${employee.id}::uuid');
    expect(declineRoute).toContain("AND ta.status = 'awaiting_driver_acceptance'");
    expect(declineRoute).toContain("NOT (COALESCE(ta.data, '{}'::jsonb) ? 'driverDecline')");
  });

  it('makes decline marker and audit depend on the successful allocation claim', () => {
    expect(declineRoute).toContain('AND EXISTS (SELECT 1 FROM allocation_claim)');
    expect(declineRoute).toContain('FROM authority_claim');
    expect(declineRoute).toContain('(SELECT count(*) FROM allocation_claim) = 1');
    expect(declineRoute).toContain("'atomic_driver_decline_failed_'");
  });

  it('shares the same optimistic version boundary with canonical acknowledgement', () => {
    expect(acknowledgement).toContain('allocationVersion: vehicleAllocations.version');
    expect(acknowledgement).toContain('SET version = version + 1');
    expect(acknowledgement).toContain('AND va.version = ${context.allocationVersion}');
    expect(acknowledgement).toContain("AND va.state = 'confirmed'");
  });
});
