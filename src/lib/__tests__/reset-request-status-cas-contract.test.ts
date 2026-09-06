import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/[id]/route.ts'),
  'utf8',
);

describe('reset request review transition compare-and-set', () => {
  it('claims the exact reviewed status and revision before changing lifecycle state', () => {
    const patch = source.indexOf('export async function PATCH');
    const update = source.indexOf('const [updated] = await db', patch);
    const idClaim = source.indexOf('eq(tenantResetRequests.id, id)', update);
    const statusClaim = source.indexOf('eq(tenantResetRequests.status, current.status)', idClaim);
    const revisionClaim = source.indexOf('eq(tenantResetRequests.updatedAt, current.updatedAt)', statusClaim);
    const returning = source.indexOf('.returning()', revisionClaim);

    expect(patch).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(patch);
    expect(idClaim).toBeGreaterThan(update);
    expect(statusClaim).toBeGreaterThan(idClaim);
    expect(revisionClaim).toBeGreaterThan(statusClaim);
    expect(returning).toBeGreaterThan(revisionClaim);
  });

  it('returns conflict and does not audit when the revision claim is lost', () => {
    const lostClaim = source.indexOf('if (!updated)');
    const conflict = source.indexOf("{ status: 409 }", lostClaim);
    const audit = source.indexOf('await recordAuditEvent', lostClaim);

    expect(lostClaim).toBeGreaterThan(-1);
    expect(conflict).toBeGreaterThan(lostClaim);
    expect(audit).toBeGreaterThan(conflict);
    expect(source).toContain('This reset request changed while the action was being prepared.');
  });
});
