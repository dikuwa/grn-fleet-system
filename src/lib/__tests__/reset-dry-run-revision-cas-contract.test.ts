import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/[id]/dry-run/route.ts'),
  'utf8',
);

describe('reset dry-run revision compare-and-set', () => {
  it('writes the preview only against the exact reviewed request revision', () => {
    const preview = source.indexOf('previewTenantOperationalReset');
    const update = source.indexOf('.update(tenantResetRequests)', preview);
    const statusClaim = source.indexOf(
      'eq(tenantResetRequests.status, resetRequest.status)',
      update,
    );
    const revisionClaim = source.indexOf(
      'eq(tenantResetRequests.updatedAt, resetRequest.updatedAt)',
      statusClaim,
    );
    const returning = source.indexOf('.returning({ id: tenantResetRequests.id })', revisionClaim);

    expect(preview).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(preview);
    expect(statusClaim).toBeGreaterThan(update);
    expect(revisionClaim).toBeGreaterThan(statusClaim);
    expect(returning).toBeGreaterThan(revisionClaim);
  });

  it('returns a conflict before notifications or audit when the revision claim is lost', () => {
    const lostClaim = source.indexOf('if (!updated)');
    const conflict = source.indexOf("{ status: 409 }", lostClaim);
    const notification = source.indexOf('resolveTenantResetReadyNotification(id)', lostClaim);
    const audit = source.indexOf('recordAuditEvent({', lostClaim);

    expect(lostClaim).toBeGreaterThan(-1);
    expect(conflict).toBeGreaterThan(lostClaim);
    expect(notification).toBeGreaterThan(conflict);
    expect(audit).toBeGreaterThan(notification);
  });
});
