import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/tenants/[id]/route.ts'),
  'utf8',
);

describe('platform tenant permanent deletion serialization', () => {
  it('locks the tenant row before assessing dependent records and deleting', () => {
    const deleteHandler = source.indexOf('export async function DELETE');
    const transaction = source.indexOf('await db.transaction', deleteHandler);
    const tenantLock = source.indexOf(".for('update')", transaction);
    const assessment = source.indexOf('getDeletionAssessment(id, tx)', tenantLock);
    const tenantDelete = source.indexOf('await tx.delete(tenants)', assessment);

    expect(deleteHandler).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(deleteHandler);
    expect(tenantLock).toBeGreaterThan(transaction);
    expect(assessment).toBeGreaterThan(tenantLock);
    expect(tenantDelete).toBeGreaterThan(assessment);
  });

  it('uses the same transaction for deletion assessment queries', () => {
    expect(source).toContain("type DeletionAssessmentDb = Pick<ReturnType<typeof getDb>, 'select'>;");
    expect(source).toContain('async function getDeletionAssessment(tenantId: string, db: DeletionAssessmentDb = getDb())');
    expect(source).toContain('getDeletionAssessment(id, tx)');
  });

  it('does not delete from a stale pre-transaction assessment', () => {
    const deleteHandler = source.indexOf('export async function DELETE');
    const transaction = source.indexOf('await db.transaction', deleteHandler);
    const staleAssessment = source.indexOf('const deletion = await getDeletionAssessment(id);', deleteHandler);

    expect(transaction).toBeGreaterThan(deleteHandler);
    expect(staleAssessment === -1 || staleAssessment > transaction).toBe(true);
  });
});
