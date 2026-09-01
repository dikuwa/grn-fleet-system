import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0108_operational_expense_receipt_staging_guard.sql'),
  'utf8',
);
const uploadRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/expenses/receipts/route.ts'),
  'utf8',
);
const closureRouteSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/close/route.ts'),
  'utf8',
);
const schemaSource = readFileSync(
  resolve(process.cwd(), 'src/db/schema/operational-expenses.ts'),
  'utf8',
);

describe('operational expense receipt closure contract', () => {
  it('persists pre-expense receipt evidence in a tenant-scoped staging ledger', () => {
    expect(schemaSource).toContain("'operational_expense_receipt_staging'");
    expect(schemaSource).toContain("fileKey: text('file_key').notNull()");
    expect(schemaSource).toContain("expenseId: uuid('expense_id')");
    expect(schemaSource).toContain("consumedAt: timestamp('consumed_at'");
    expect(schemaSource).toContain('uq_operational_expense_receipt_staging_tenant_key');
  });

  it('serializes staging mutations with the authoritative trip and rejects closed-trip evidence', () => {
    expect(migrationSource).toContain('enforce_operational_expense_receipt_staging_lifecycle');
    expect(migrationSource).toContain('FOR UPDATE;');
    expect(migrationSource).toContain("v_trip_status = 'closed'");
    expect(migrationSource).toContain('closed_trip_expense_receipt_immutable');
    expect(migrationSource).toContain("ERRCODE = '23514'");
  });

  it('blocks final closure while committed staged receipt evidence remains unconsumed', () => {
    expect(migrationSource).toContain('enforce_trip_closure_operational_expense_receipts');
    expect(migrationSource).toContain('BEFORE UPDATE OF status ON trips');
    expect(migrationSource).toContain("NEW.status = 'closed'");
    expect(migrationSource).toContain('staged.expense_id IS NULL');
    expect(migrationSource).toContain('staged.consumed_at IS NULL');
    expect(migrationSource).toContain('trip_closure_lifecycle_conflict');
    expect(closureRouteSource).toContain("message.includes('trip_closure_lifecycle_conflict')");
  });

  it('consumes matching staging evidence automatically when the expense commits', () => {
    expect(migrationSource).toContain('consume_operational_expense_receipt_staging');
    expect(migrationSource).toContain('AFTER INSERT OR UPDATE OF receipt_key ON trip_expenses');
    expect(migrationSource).toContain('staged.file_key = NEW.receipt_key');
    expect(migrationSource).toContain('staged.trip_id IS NOT DISTINCT FROM NEW.trip_id');
    expect(migrationSource).toContain('expense_id = NEW.id');
    expect(migrationSource).toContain('consumed_at = now()');
  });

  it('commits staging and audit together after storage upload', () => {
    expect(uploadRouteSource).toContain('runAtomicMutations((executor) => [');
    expect(uploadRouteSource).toContain('executor.insert(operationalExpenseReceiptStaging)');
    expect(uploadRouteSource).toContain("eventType: 'expense_receipt_uploaded'");
  });

  it('removes the object when the database loses the closure race and returns a recoverable conflict', () => {
    expect(uploadRouteSource).toContain('await deleteFile(key)');
    expect(uploadRouteSource).toContain('closed_trip_expense_receipt_immutable');
    expect(uploadRouteSource).toContain('Expense receipt evidence is immutable.');
    expect(uploadRouteSource).toContain('{ status: 409 }');
  });
});
