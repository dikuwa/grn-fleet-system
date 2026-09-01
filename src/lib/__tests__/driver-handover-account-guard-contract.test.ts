import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const handoverRoute = readFileSync('src/app/api/trips/[id]/driver-handover/route.ts', 'utf8');
const migration = readFileSync('src/db/migrations/0111_relief_driver_account_guard.sql', 'utf8');

describe('relief-driver handover account contract', () => {
  it('keeps acknowledgement tied to the authenticated employee account', () => {
    expect(handoverRoute).toContain('userId: employees.userId');
    expect(handoverRoute).toContain('eq(employees.userId, session.user.id)');
    expect(handoverRoute).toContain("'/dashboard/driver-mobile'");
    expect(handoverRoute).toContain("Permissions.DRIVER_LOG_CREATE");
  });

  it('rejects pending relief assignments without an active linked account at the database boundary', () => {
    expect(migration).toContain('guard_pending_relief_driver_account');
    expect(migration).toContain("NEW.driver_type = 'relief'");
    expect(migration).toContain('NEW.acknowledged_at IS NULL');
    expect(migration).toContain("e.employment_status = 'active'");
    expect(migration).toContain('e.user_id IS NOT NULL');
    expect(migration).toContain(
      "RAISE EXCEPTION 'atomic_driver_handover_initiate_failed relief_driver_account_required'",
    );
  });

  it('keeps the account identity stable while an active relief handover is pending', () => {
    expect(migration).toContain('OLD.user_id IS DISTINCT FROM NEW.user_id');
    expect(migration).toContain("tad.driver_type = 'relief'");
    expect(migration).toContain('tad.acknowledged_at IS NULL');
    expect(migration).toContain("t.status IN ('in_progress', 'return_due')");
    expect(migration).toContain("RAISE EXCEPTION 'pending_relief_driver_account_change_blocked'");
    expect(migration).toContain('BEFORE UPDATE OF user_id');
  });

  it('maps an initiation-time account race through the existing refreshable conflict response', () => {
    expect(handoverRoute).toContain("String(error).includes('atomic_driver_handover_initiate_failed')");
    expect(handoverRoute).toContain('{ status: 409 }');
  });
});
