import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const actionSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/documents/[id]/action/route.ts'),
  'utf8',
);
const pdfSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/documents/[id]/pdf/route.ts'),
  'utf8',
);

describe('document UUID boundary guards', () => {
  it('keeps issuance auth, dashboard access, and action validation before the id guard', () => {
    const postIndex = actionSource.indexOf('export async function POST');
    const authIndex = actionSource.indexOf('const auth = await requireRequestAuth(request)', postIndex);
    const dashboardIndex = actionSource.indexOf("'/dashboard/documents'", authIndex);
    const actionValidationIndex = actionSource.indexOf("if (action !== 'issue')", dashboardIndex);
    const guardIndex = actionSource.indexOf('if (!UUID_PATTERN.test(id))', actionValidationIndex);
    const dbIndex = actionSource.indexOf('const db = getDb();', guardIndex);

    expect(actionSource).toContain('const UUID_PATTERN =');
    expect(authIndex).toBeGreaterThan(postIndex);
    expect(dashboardIndex).toBeGreaterThan(authIndex);
    expect(actionValidationIndex).toBeGreaterThan(dashboardIndex);
    expect(guardIndex).toBeGreaterThan(actionValidationIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(actionSource.slice(guardIndex, dbIndex)).toContain("{ error: 'Document not found' }");
    expect(actionSource.slice(guardIndex, dbIndex)).toContain('{ status: 404 }');
  });

  it('keeps PDF authentication ahead of the id guard and database access', () => {
    const getIndex = pdfSource.indexOf('export async function GET');
    const authIndex = pdfSource.indexOf('const auth = await requireRequestAuth(request)', getIndex);
    const guardIndex = pdfSource.indexOf('if (!UUID_PATTERN.test(id))', authIndex);
    const dbIndex = pdfSource.indexOf('const db = getDb();', guardIndex);

    expect(pdfSource).toContain('const UUID_PATTERN =');
    expect(authIndex).toBeGreaterThan(getIndex);
    expect(guardIndex).toBeGreaterThan(authIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(pdfSource.slice(guardIndex, dbIndex)).toContain("{ error: 'Document not found' }");
    expect(pdfSource.slice(guardIndex, dbIndex)).toContain('{ status: 404 }');
  });

  it('keeps the existing issuance concurrency predicates intact after the guard', () => {
    const guardIndex = actionSource.indexOf('if (!UUID_PATTERN.test(id))');
    const targetStillDraftIndex = actionSource.indexOf('const targetStillDraft = sql`exists', guardIndex);
    const atomicIndex = actionSource.indexOf('await runAtomicMutations((tx) => [', targetStillDraftIndex);
    const conflictIndex = actionSource.indexOf('This draft or its authority lifecycle changed while the issue action was being prepared.', atomicIndex);

    expect(targetStillDraftIndex).toBeGreaterThan(guardIndex);
    expect(atomicIndex).toBeGreaterThan(targetStillDraftIndex);
    expect(conflictIndex).toBeGreaterThan(atomicIndex);
  });
});
