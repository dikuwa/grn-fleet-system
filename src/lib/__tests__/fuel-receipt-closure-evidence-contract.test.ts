import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'src/db/migrations/0101_fuel_receipt_closure_evidence_guard.sql'),
  'utf8',
);
const receiptRoute = readFileSync(
  join(process.cwd(), 'src/app/api/fuel/receipts/route.ts'),
  'utf8',
);
const terminalReviewGuard = readFileSync(
  join(process.cwd(), 'src/db/migrations/0093_fuel_receipt_terminal_review_guard.sql'),
  'utf8',
);

describe('fuel receipt evidence closure boundary', () => {
  it('serializes receipt evidence mutations with the linked trip', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enforce_fuel_receipt_closure_evidence()');
    expect(migration).toContain('FROM fuel_transactions ft');
    expect(migration).toContain('JOIN vehicles v ON v.id = ft.vehicle_id');
    expect(migration).toContain('FOR UPDATE OF t;');
    expect(migration).toContain("RAISE EXCEPTION 'closed_trip_receipt_immutable:%'");
    expect(migration).toContain('BEFORE INSERT OR UPDATE OR DELETE ON fuel_receipts');
  });

  it('preserves the independent terminal receipt review guard', () => {
    expect(terminalReviewGuard).toContain('trg_fuel_receipts_terminal_review_guard');
    expect(terminalReviewGuard).toContain('BEFORE UPDATE OF "ocr_status"');
    expect(migration).not.toContain('DROP TRIGGER IF EXISTS "trg_fuel_receipts_terminal_review_guard"');
  });

  it('rejects already-closed trip receipt work before upload or mutation', () => {
    const postPreflight = receiptRoute.indexOf(
      "context.transaction.tripId && context.tripStatus === 'closed'",
    );
    const upload = receiptRoute.indexOf('await uploadFile(original, key, {');
    const patchPreflight = receiptRoute.indexOf("record.tripId && record.tripStatus === 'closed'");

    expect(postPreflight).toBeGreaterThanOrEqual(0);
    expect(upload).toBeGreaterThan(postPreflight);
    expect(patchPreflight).toBeGreaterThanOrEqual(0);
    expect(receiptRoute).toContain('Fuel receipt evidence is immutable.');
  });

  it('removes an uploaded object when the atomic receipt mutation does not commit', () => {
    expect(receiptRoute).toContain("import { buildKey, deleteFile, isStorageConfigured, uploadFile } from '@/lib/storage';");
    const atomicStart = receiptRoute.indexOf('try {\n      await runAtomicMutations((executor) => {');
    const cleanup = receiptRoute.indexOf('await deleteFile(key).catch((cleanupError) => {');
    const reload = receiptRoute.indexOf('const [receipt] = await db');

    expect(atomicStart).toBeGreaterThanOrEqual(0);
    expect(cleanup).toBeGreaterThan(atomicStart);
    expect(reload).toBeGreaterThan(cleanup);
  });

  it('maps closure races separately from terminal-review conflicts', () => {
    expect(receiptRoute).toContain("message.includes('closed_trip_receipt_immutable')");
    expect(receiptRoute).toContain('if (receiptClosureConflict(error))');
    expect(receiptRoute).toContain("if ((error as { code?: string })?.code === '23514')");
    expect(receiptRoute).toContain('{ status: 409 }');
  });
});
