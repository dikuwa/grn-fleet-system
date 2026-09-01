import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const parentGuardSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0107_fuel_receipt_parent_verification_guard.sql'),
  'utf8',
);
const closureGuardSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0101_fuel_receipt_closure_evidence_guard.sql'),
  'utf8',
);

describe('fuel receipt parent verification contract', () => {
  it('keeps closed-trip receipt evidence serialized at the trip boundary', () => {
    expect(closureGuardSource).toContain('FOR UPDATE OF t');
    expect(closureGuardSource).toContain("v_trip_status = 'closed'");
    expect(closureGuardSource).toContain('closed_trip_receipt_immutable');
  });

  it('defers parent recomputation until all receipt mutations in the transaction have run', () => {
    expect(parentGuardSource).toContain('CREATE CONSTRAINT TRIGGER');
    expect(parentGuardSource).toContain('AFTER INSERT OR UPDATE OR DELETE ON fuel_receipts');
    expect(parentGuardSource).toContain('DEFERRABLE INITIALLY DEFERRED');
    expect(parentGuardSource).toContain('sync_fuel_transaction_receipt_verification');
  });

  it('serializes sibling receipt review on the authoritative parent transaction', () => {
    expect(parentGuardSource).toContain('FROM fuel_transactions');
    expect(parentGuardSource).toContain('FOR UPDATE;');
    expect(parentGuardSource).toContain('FROM fuel_receipts');
    expect(parentGuardSource).toContain('WHERE transaction_id = v_transaction_id');
    expect(parentGuardSource).toContain("ocr_status = 'rejected'");
    expect(parentGuardSource).toContain('is_verified = false');
  });

  it('derives the final parent state from committed receipt evidence', () => {
    expect(parentGuardSource).toContain("anomaly_state = 'rejected'");
    expect(parentGuardSource).toContain("anomaly_state = 'flagged'");
    expect(parentGuardSource).toContain("anomaly_state = 'verified'");
    expect(parentGuardSource).toContain('is_verified = true');
    expect(parentGuardSource).toContain('is_verified = false');
    expect(parentGuardSource).toContain('verified_by_user_id = v_latest_verifier');
  });

  it('reopens a verified parent when pending evidence is inserted or all evidence is removed', () => {
    expect(parentGuardSource).toContain('ELSIF v_pending > 0 THEN');
    expect(parentGuardSource).toContain('IF v_total = 0 THEN');
    expect(parentGuardSource).toContain('No linked receipt evidence remains after receipt mutation');
    expect(parentGuardSource).toContain('Awaiting verification of ');
  });

  it('handles trigger records safely and re-parenting deterministically', () => {
    expect(parentGuardSource).toContain("IF TG_OP = 'INSERT' THEN");
    expect(parentGuardSource).toContain("ELSIF TG_OP = 'DELETE' THEN");
    expect(parentGuardSource).toContain(
      'v_transaction_ids := ARRAY[OLD.transaction_id, NEW.transaction_id]',
    );
    expect(parentGuardSource).toContain('SELECT DISTINCT transaction_id');
    expect(parentGuardSource).toContain('FROM unnest(v_transaction_ids)');
    expect(parentGuardSource).toContain('ORDER BY transaction_id');
  });
});
