import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/[id]/route.ts'),
  'utf8',
);

describe('reset request review transition compare-and-set', () => {
  it('claims the reviewed business state before changing lifecycle state', () => {
    const patch = source.indexOf('export async function PATCH');
    const guards = source.indexOf('const actionGuards = [', patch);
    const idClaim = source.indexOf('eq(tenantResetRequests.id, id)', guards);
    const statusClaim = source.indexOf(
      'eq(tenantResetRequests.status, current.status)',
      idClaim,
    );
    const validationGuard = source.indexOf(
      "if (action === 'approve' || action === 'renew')",
      statusClaim,
    );
    const validationNullClaim = source.indexOf(
      'isNull(tenantResetRequests.validationResults)',
      validationGuard,
    );
    const validationValueClaim = source.indexOf(
      'eq(tenantResetRequests.validationResults, current.validationResults)',
      validationNullClaim,
    );
    const renewalGuard = source.indexOf("if (action === 'renew')", validationValueClaim);
    const reviewNotesNullClaim = source.indexOf(
      'isNull(tenantResetRequests.reviewNotes)',
      renewalGuard,
    );
    const reviewNotesValueClaim = source.indexOf(
      'eq(tenantResetRequests.reviewNotes, current.reviewNotes)',
      reviewNotesNullClaim,
    );
    const update = source.indexOf('const [updated] = await db', reviewNotesValueClaim);
    const where = source.indexOf('.where(and(...actionGuards))', update);
    const returning = source.indexOf('.returning()', where);

    expect(patch).toBeGreaterThan(-1);
    expect(guards).toBeGreaterThan(patch);
    expect(idClaim).toBeGreaterThan(guards);
    expect(statusClaim).toBeGreaterThan(idClaim);
    expect(validationGuard).toBeGreaterThan(statusClaim);
    expect(validationNullClaim).toBeGreaterThan(validationGuard);
    expect(validationValueClaim).toBeGreaterThan(validationNullClaim);
    expect(renewalGuard).toBeGreaterThan(validationValueClaim);
    expect(reviewNotesNullClaim).toBeGreaterThan(renewalGuard);
    expect(reviewNotesValueClaim).toBeGreaterThan(reviewNotesNullClaim);
    expect(update).toBeGreaterThan(reviewNotesValueClaim);
    expect(where).toBeGreaterThan(update);
    expect(returning).toBeGreaterThan(where);
    expect(source).not.toContain('eq(tenantResetRequests.updatedAt, current.updatedAt)');
  });

  it('returns conflict and does not audit when the business-state claim is lost', () => {
    const lostClaim = source.indexOf('if (!updated)');
    const conflict = source.indexOf("{ status: 409 }", lostClaim);
    const audit = source.indexOf('await recordAuditEvent', lostClaim);

    expect(lostClaim).toBeGreaterThan(-1);
    expect(conflict).toBeGreaterThan(lostClaim);
    expect(audit).toBeGreaterThan(conflict);
    expect(source).toContain('This reset request changed while the action was being prepared.');
  });
});
