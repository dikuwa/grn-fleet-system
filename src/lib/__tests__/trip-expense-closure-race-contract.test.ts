import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'src/db/migrations/0099_trip_expense_active_lifecycle_guard.sql'),
  'utf8',
);
const operationsRoute = readFileSync(
  join(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);

describe('trip expense closure race guard', () => {
  it('serializes fresh expense inserts with the authoritative tenant-scoped trip', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enforce_trip_expense_active_lifecycle()');
    expect(migration).toContain('t.id = NEW.trip_id');
    expect(migration).toContain('t.tenant_id = NEW.tenant_id');
    expect(migration).toContain('FOR UPDATE OF t;');
    expect(migration).toContain("v_trip_status NOT IN ('in_progress', 'return_due', 'closure_review')");
    expect(migration).toContain('BEFORE INSERT ON trip_expenses');
  });

  it('uses the shared nested parser and operations conflict response when closure wins the race', () => {
    expect(migration).toContain("ERRCODE = '23505'");
    expect(operationsRoute).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(operationsRoute).toContain('const { message, code } = getDatabaseErrorDetails(error);');
    expect(operationsRoute).toContain("message.includes('trip_expense_lifecycle_conflict')");
    expect(operationsRoute).toContain("if (code === '23505')");
    expect(operationsRoute).toContain("{ status: 409 }");
  });

  it('preserves committed offline expense replay before live lifecycle enforcement', () => {
    const replayLookup = operationsRoute.indexOf('eq(tripExpenses.clientSyncId, clientSyncId)');
    const expenseLifecycleCheck = operationsRoute.indexOf("action === 'expense' && !['in_progress', 'return_due', 'closure_review'].includes(context.tripStatus)");
    const expenseInsert = operationsRoute.indexOf('executor.insert(tripExpenses).values({');

    expect(replayLookup).toBeGreaterThanOrEqual(0);
    expect(expenseLifecycleCheck).toBeGreaterThan(replayLookup);
    expect(expenseInsert).toBeGreaterThan(expenseLifecycleCheck);
  });
});
