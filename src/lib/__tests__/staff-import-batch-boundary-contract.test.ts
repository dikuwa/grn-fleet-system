import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const importRoute = readFileSync('src/app/api/import/route.ts', 'utf8');

describe('staff import fail-fast boundary contract', () => {
  it('rejects oversized batches before opening database work', () => {
    const sizeGuard = importRoute.indexOf('const sizeError = staffImportSizeError(rows.length)');
    const dbLookup = importRoute.indexOf('const db = getDb()');

    expect(sizeGuard).toBeGreaterThan(-1);
    expect(importRoute).toContain("{ status: 413 }");
    expect(dbLookup).toBeGreaterThan(sizeGuard);
  });

  it('does not advertise the old unproven 10,000-row synchronous workload', () => {
    expect(importRoute).not.toContain('rows.length > 10_000');
    expect(importRoute).not.toContain('Imports are limited to 10,000 rows.');
  });

  it('documents the transaction shape the boundary protects', () => {
    expect(importRoute).toContain('all-or-nothing interactive transaction');
    expect(importRoute).toContain('row-by-row');
    expect(importRoute).toContain('await db.transaction(async (tx) =>');
  });
});
