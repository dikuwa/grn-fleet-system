import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/[id]/route.ts'),
  'utf8',
);

describe('platform reset action business-state compare-and-set', () => {
  it('does not use updatedAt as a precision-sensitive revision token', () => {
    const actionGuards = source.indexOf('const actionGuards = [');
    const update = source.indexOf('.update(tenantResetRequests)', actionGuards);

    expect(actionGuards).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(actionGuards);
    expect(source.slice(actionGuards, update)).not.toContain(
      'eq(tenantResetRequests.updatedAt, current.updatedAt)',
    );
  });

  it('fences approval and renewal against the exact nullable reviewed validation state', () => {
    const actionGuards = source.indexOf('const actionGuards = [');
    const approvalGuard = source.indexOf("if (action === 'approve' || action === 'renew')", actionGuards);
    const nullableValidationGuard = source.indexOf(
      'isNull(tenantResetRequests.validationResults)',
      approvalGuard,
    );
    const exactValidationGuard = source.indexOf(
      'eq(tenantResetRequests.validationResults, current.validationResults)',
      nullableValidationGuard,
    );
    const update = source.indexOf('.update(tenantResetRequests)', exactValidationGuard);

    expect(approvalGuard).toBeGreaterThan(actionGuards);
    expect(nullableValidationGuard).toBeGreaterThan(approvalGuard);
    expect(exactValidationGuard).toBeGreaterThan(nullableValidationGuard);
    expect(update).toBeGreaterThan(exactValidationGuard);
  });

  it('fences renewal against the prior review note so concurrent renewals cannot both win', () => {
    const actionGuards = source.indexOf('const actionGuards = [');
    const renewGuard = source.indexOf("if (action === 'renew')", actionGuards);
    const nullableNoteGuard = source.indexOf('isNull(tenantResetRequests.reviewNotes)', renewGuard);
    const exactNoteGuard = source.indexOf(
      'eq(tenantResetRequests.reviewNotes, current.reviewNotes)',
      nullableNoteGuard,
    );
    const where = source.indexOf('.where(and(...actionGuards))', exactNoteGuard);

    expect(renewGuard).toBeGreaterThan(actionGuards);
    expect(nullableNoteGuard).toBeGreaterThan(renewGuard);
    expect(exactNoteGuard).toBeGreaterThan(nullableNoteGuard);
    expect(where).toBeGreaterThan(exactNoteGuard);
  });
});