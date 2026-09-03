import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);
const progressGuardSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0098_trip_progress_active_lifecycle_guard.sql'),
  'utf8',
);
const expenseGuardSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0099_trip_expense_active_lifecycle_guard.sql'),
  'utf8',
);
const progressOdometerGuardSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0106_trip_progress_odometer_sequence_guard.sql'),
  'utf8',
);

describe('trip operation lifecycle race contract', () => {
  it('keeps journey progress serialized with trip and authority lifecycle transitions', () => {
    expect(progressGuardSource).toContain('FOR UPDATE OF t, ta');
    expect(progressGuardSource).toContain("v_trip_status NOT IN ('in_progress', 'return_due')");
    expect(progressGuardSource).toContain("v_authority_status = 'incident_reported'");
    expect(progressGuardSource).toContain('trip_progress_lifecycle_conflict');
  });

  it('keeps expense capture serialized with final trip closure', () => {
    expect(expenseGuardSource).toContain('FOR UPDATE OF t');
    expect(expenseGuardSource).toContain(
      "v_trip_status NOT IN ('in_progress', 'return_due', 'closure_review')",
    );
    expect(expenseGuardSource).toContain('trip_expense_lifecycle_conflict');
  });

  it('serializes chronological progress odometer evidence per trip', () => {
    expect(progressOdometerGuardSource).toContain('FOR UPDATE OF t, ta');
    expect(progressOdometerGuardSource).toContain('MAX(tpe.odometer_reading)');
    expect(progressOdometerGuardSource).toContain('MIN(tpe.odometer_reading)');
    expect(progressOdometerGuardSource).toContain('tpe.occurred_at <= NEW.occurred_at');
    expect(progressOdometerGuardSource).toContain('tpe.occurred_at >= NEW.occurred_at');
    expect(progressOdometerGuardSource).toContain('NEW.odometer_reading < v_previous_max');
    expect(progressOdometerGuardSource).toContain('NEW.odometer_reading > v_next_min');
    expect(progressOdometerGuardSource).toContain('trip_progress_lifecycle_conflict');
  });

  it('retains defensive in-batch lifecycle checks before inserting operations', () => {
    expect(routeSource).toContain('trip_progress_lifecycle_conflict');
    expect(routeSource).toContain("status IN ('in_progress', 'return_due')");
    expect(routeSource).toContain('trip_expense_lifecycle_conflict');
    expect(routeSource).toContain("status IN ('in_progress', 'return_due', 'closure_review')");
  });

  it('uses the shared nested database parser and maps lifecycle races before generic duplicates', () => {
    expect(routeSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(routeSource).toContain('const { message, code } = getDatabaseErrorDetails(error);');
    expect(routeSource).toContain("message.includes('trip_progress_lifecycle_conflict')");
    expect(routeSource).toContain("message.includes('trip_expense_lifecycle_conflict')");
    expect(routeSource.indexOf("message.includes('trip_progress_lifecycle_conflict')")).toBeLessThan(
      routeSource.indexOf("if (code === '23505')"),
    );
    expect(routeSource).toContain('The trip lifecycle changed while this operation was being saved. Refresh and review the latest trip state.');
    expect(routeSource).toContain('{ status: 409 }');
    expect(routeSource).not.toContain('const causeRecord =');
  });
});
