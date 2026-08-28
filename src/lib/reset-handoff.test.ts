import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isResetApprovalExpired,
  resetApprovalExpiresAt,
  RESET_APPROVAL_TTL_HOURS,
} from './reset-execution-guard';

function source(path: string) {
  return readFileSync(path, 'utf8');
}

describe('tenant reset execution handoff boundary', () => {
  it('expires approvals instead of leaving destructive plans executable forever', () => {
    const reviewedAt = new Date('2026-08-01T10:00:00.000Z');
    const expiresAt = resetApprovalExpiresAt(reviewedAt);
    expect(expiresAt?.getTime()).toBe(
      reviewedAt.getTime() + RESET_APPROVAL_TTL_HOURS * 60 * 60 * 1000,
    );
    expect(isResetApprovalExpired(reviewedAt, new Date(expiresAt!.getTime() - 1))).toBe(false);
    expect(isResetApprovalExpired(reviewedAt, expiresAt!)).toBe(true);
  });

  it('tenant execution is permissioned, tenant-scoped and uses the shared guarded engine', () => {
    const route = source('src/app/api/admin/data-reset/[id]/execute/route.ts');
    expect(route).toContain('Permissions.TENANT_MANAGE');
    expect(route).toContain('eq(tenantResetRequests.tenantId, session.tenantId)');
    expect(route).toContain('resetExecutionOwner({ createdFrom: metadata.createdFrom');
    expect(route).toContain('tenantId: session.tenantId');
    expect(route).toContain('executeApprovedTenantOperationalReset');
    expect(route).toContain('confirmationPhrase');
    expect(route).not.toContain('Permissions.RESET_MANAGE');
  });

  it('the reset engine independently enforces actor tenant and immutable safety checks', () => {
    const service = source('src/lib/data-protection/reset-service-core.ts');
    expect(service).toContain('resetRequest.tenantId !== input.actorTenantId');
    expect(service).toContain("throw new Error('Reset request not found')");
    expect(service).toContain("resetRequest.status !== 'approved'");
    expect(service).toContain('matchesTenantExecutionResetPhrase');
    expect(service).toContain('freshPreview.fingerprint !== storedFingerprint');
    expect(service).toContain("backup.status !== 'ready'");
    expect(service).toContain('readBackupPayload(backup.id)');
  });

  it('uses a transaction-local governed-reset boundary without weakening ordinary trip immutability', () => {
    const service = source('src/lib/data-protection/reset-service-core.ts');
    const migration = source('src/db/migrations/0091_governed_reset_financial_boundary.sql');

    expect(service).toContain("set_config('govfleet.governed_reset', 'on', true)");
    expect(migration).toContain("current_setting('govfleet.governed_reset', true) = 'on'");
    expect(migration).toContain("old_trip_status = 'closed'");
    expect(migration).toContain("new_trip_status = 'closed'");
    expect(migration).toContain("RAISE EXCEPTION 'closed_trip_financial_immutable:%'");
  });

  it('keeps reviewed impact separate from the rows actually removed', () => {
    const service = source('src/lib/data-protection/reset-service-core.ts');
    expect(service).toContain('dryRunSummary: freshPreview.dryRunSummary');
    expect(service).toContain('totalRemoved,');
    expect(service).not.toContain(
      'dryRunSummary: { ...freshPreview.dryRunSummary, total: totalRemoved }',
    );
  });

  it('bounds recovery storage operations and reconciles abandoned attempts', () => {
    const backup = source('src/lib/data-protection/backup-service.ts');
    const storage = source('src/lib/storage.ts');
    const page = source('src/app/(dashboard)/dashboard/platform/reset/page.tsx');

    expect(backup).toContain(': 120_000');
    expect(backup).toContain('failStaleCreatingBackups');
    expect(backup).toContain('withinBackupDeadline');
    expect(backup).toContain('withinBackupDeadline(bodyToText(file.body), deadlineAt)');
    expect(storage).toContain('send(controller.signal)');
    expect(storage).toContain('Promise.race([send(controller.signal), timeout])');
    expect(page).toContain('Creating and verifying recovery point…');
    expect(page).toContain('two-minute storage deadline');
  });

  it('cleans ordinary tenant communications while preserving reset governance notifications', () => {
    const plan = source('src/lib/data-reset/plan.ts');
    expect(plan).toContain("entity_type IS DISTINCT FROM 'reset_request'");
    expect(plan).toContain('n.created_at < ${cutoff}');
  });

  it('includes programme-derived documents and notification history in selective cleanup', () => {
    const plan = source('src/lib/data-protection/advanced-reset-plan.ts');
    expect(plan).toContain('Programme generated documents');
    expect(plan).toContain('Programme document access events');
    expect(plan).toContain('Programme notification deliveries');
    expect(plan).toContain("entity_type = 'programme'");
  });

  it('platform execution refuses tenant-owned operational/selective plans', () => {
    const route = source('src/app/api/platform/reset/[id]/execute/route.ts');
    expect(route).toContain('Permissions.RESET_MANAGE');
    expect(route).toContain('resetExecutionOwner');
    expect(route).toContain('has been handed back to the authorised Tenant Administrator');

    const page = source('src/app/(dashboard)/dashboard/platform/reset/page.tsx');
    expect(page).toContain("selectedExecutionOwner === 'platform'");
    expect(page).toContain('Tenant execution handoff');
    expect(page).toContain('{!selected.approvalExpired && canPlatformExecute && (');
  });

  it('treats expiry as a recoverable workflow state without weakening execution guards', () => {
    const tenantRoute = source('src/app/api/admin/data-reset/route.ts');
    expect(tenantRoute).toContain('isResetRequestBlocking');

    const platformRoute = source('src/app/api/platform/reset/[id]/route.ts');
    expect(platformRoute).toContain("case 'renew'");
    expect(platformRoute).toContain(
      'Run and review a fresh impact preview before renewing approval',
    );
    expect(platformRoute).toContain('plannedAt <= current.reviewedAt');
    expect(platformRoute).toContain('isResetRequestBlocking');

    const backupRoute = source('src/app/api/platform/reset/[id]/backup/route.ts');
    expect(backupRoute).toContain('isResetApprovalExpired(resetRequest.reviewedAt)');
    expect(backupRoute).toContain('Approval expired');
  });
});
