import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const importRoute = readFileSync('src/app/api/import/route.ts', 'utf8');
const importPage = readFileSync('src/app/(dashboard)/dashboard/staff/import/page.tsx', 'utf8');
const employeeNumber = readFileSync('src/lib/employee-number.ts', 'utf8');

const MAX_STAFF_IMPORT_ROWS = 500;

describe('staff import scale contract', () => {
  it('keeps the synchronous atomic import within an explicit bounded workload', () => {
    expect(importRoute).toContain(`rows.length > ${MAX_STAFF_IMPORT_ROWS}`);
    expect(importRoute).toContain(`Staff imports are limited to ${MAX_STAFF_IMPORT_ROWS} rows per batch.`);
    expect(importPage).toContain(`MAX_STAFF_IMPORT_ROWS = ${MAX_STAFF_IMPORT_ROWS}`);
  });

  it('does not advertise a 10,000-row synchronous transaction', () => {
    expect(importRoute).not.toContain('rows.length > 10_000');
    expect(importRoute).not.toContain('Imports are limited to 10,000 rows.');
  });

  it('documents why the current path remains bounded until bulk allocation/inserts are introduced', () => {
    expect(importRoute).toContain('interactive transaction');
    expect(importRoute).toContain('row-by-row');
    expect(employeeNumber).toContain('employeeNumberCounters');
    expect(employeeNumber).toContain('.onConflictDoUpdate');
  });
});
