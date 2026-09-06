import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/platform/reset/[id]/dry-run/route.ts'),
  'utf8',
);

describe('reset dry-run business-state compare-and-set', () => {
  it('writes the preview only against the exact reviewed business state', () => {
    const preview = source.indexOf('previewTenantOperationalReset');
    const validationState = source.indexOf('const validationState =', preview);
    const validationNull = source.indexOf('isNull(tenantResetRequests.validationResults)', validationState);
    const validationExact = source.indexOf(
      'eq(tenantResetRequests.validationResults, resetRequest.validationResults)',
      validationNull,
    );
    const metadataState = source.indexOf('const metadataState =', validationExact);
    const metadataNull = source.indexOf('isNull(tenantResetRequests.metadata)', metadataState);
    const metadataExact = source.indexOf(
      'eq(tenantResetRequests.metadata, resetRequest.metadata)',
      metadataNull,
    );
    const update = source.indexOf('.update(tenantResetRequests)', metadataExact);
    const statusClaim = source.indexOf(
      'eq(tenantResetRequests.status, resetRequest.status)',
      update,
    );
    const validationClaim = source.indexOf('validationState', statusClaim);
    const metadataClaim = source.indexOf('metadataState', validationClaim);
    const returning = source.indexOf('.returning({ id: tenantResetRequests.id })', metadataClaim);

    expect(preview).toBeGreaterThan(-1);
    expect(validationState).toBeGreaterThan(preview);
    expect(validationNull).toBeGreaterThan(validationState);
    expect(validationExact).toBeGreaterThan(validationNull);
    expect(metadataState).toBeGreaterThan(validationExact);
    expect(metadataNull).toBeGreaterThan(metadataState);
    expect(metadataExact).toBeGreaterThan(metadataNull);
    expect(update).toBeGreaterThan(metadataExact);
    expect(statusClaim).toBeGreaterThan(update);
    expect(validationClaim).toBeGreaterThan(statusClaim);
    expect(metadataClaim).toBeGreaterThan(validationClaim);
    expect(returning).toBeGreaterThan(metadataClaim);
    expect(source).not.toContain('eq(tenantResetRequests.updatedAt, resetRequest.updatedAt)');
  });

  it('returns a conflict before notifications or audit when the state claim is lost', () => {
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