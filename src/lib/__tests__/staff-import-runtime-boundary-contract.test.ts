import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/import/route.ts'),
  'utf8',
);

describe('staff import runtime boundary contract', () => {
  it('rejects oversized imports before opening a database handle', () => {
    expect(routeSource).toContain('const MAX_STAFF_IMPORT_ROWS = 500;');
    expect(routeSource).toContain('rows.length > MAX_STAFF_IMPORT_ROWS');
    expect(routeSource).toContain("{ status: 413 }");
    expect(routeSource).toContain('maxRows: MAX_STAFF_IMPORT_ROWS');
    expect(routeSource).toContain('receivedRows: rows.length');

    const guardIndex = routeSource.indexOf('rows.length > MAX_STAFF_IMPORT_ROWS');
    const dbIndex = routeSource.indexOf('const db = getDb();');

    expect(guardIndex).toBeGreaterThan(-1);
    expect(dbIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeLessThan(dbIndex);
  });

  it('removes the old 10,000-row synchronous contract', () => {
    expect(routeSource).not.toContain('10_000');
    expect(routeSource).not.toContain('10,000 rows');
  });

  it('keeps accepted batches on the existing all-or-nothing transaction path', () => {
    const dbIndex = routeSource.indexOf('const db = getDb();');
    const validationIndex = routeSource.indexOf('const invalid = prepared.filter');
    const transactionIndex = routeSource.indexOf('await db.transaction(async (tx) =>');
    const employeeInsertIndex = routeSource.indexOf('await tx.insert(employees).values');
    const importRowInsertIndex = routeSource.indexOf('await tx.insert(importRows).values');

    expect(dbIndex).toBeGreaterThan(-1);
    expect(validationIndex).toBeGreaterThan(dbIndex);
    expect(transactionIndex).toBeGreaterThan(validationIndex);
    expect(employeeInsertIndex).toBeGreaterThan(transactionIndex);
    expect(importRowInsertIndex).toBeGreaterThan(employeeInsertIndex);
  });
});
