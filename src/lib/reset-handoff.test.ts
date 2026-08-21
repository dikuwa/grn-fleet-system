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
    const service = source('src/lib/data-protection/reset-service.ts');
    expect(service).toContain('resetRequest.tenantId !== input.actorTenantId');
    expect(service).toContain("throw new Error('Reset request not found')");
    expect(service).toContain("resetRequest.status !== 'approved'");
    expect(service).toContain('matchesTenantExecutionResetPhrase');
    expect(service).toContain('freshPreview.fingerprint !== storedFingerprint');
    expect(service).toContain("backup.status !== 'ready'");
    expect(service).toContain('readBackupPayload(backup.id)');
  });

  it('platform execution refuses tenant-owned operational/selective plans', () => {
    const route = source('src/app/api/platform/reset/[id]/execute/route.ts');
    expect(route).toContain('Permissions.RESET_MANAGE');
    expect(route).toContain('resetExecutionOwner');
    expect(route).toContain('has been handed back to the authorised Tenant Administrator');

    const page = source('src/app/(dashboard)/dashboard/platform/reset/page.tsx');
    expect(page).toContain("selectedExecutionOwner === 'platform'");
    expect(page).toContain('Tenant execution handoff');
    expect(page).toContain('{canPlatformExecute && (');
  });
});

describe('reset notification delivery contract', () => {
  it('creates separate approval and executable-readiness tenant events', () => {
    const notifications = source('src/lib/platform/reset-notifications.ts');
    expect(notifications).toContain("title: 'Your reset request was approved'");
    expect(notifications).toContain("eventType: 'tenant_reset_ready'");
    expect(notifications).toContain("title: 'Your approved reset is ready to execute'");
    expect(notifications).toContain("status: 'action_required'");
    expect(notifications).toContain('mandatory: true');
    expect(notifications).toContain('WorkspaceIds.TENANT_ADMIN');

    const backupRoute = source('src/app/api/platform/reset/[id]/backup/route.ts');
    expect(backupRoute).toContain('notifyResetRequesterReady');
  });

  it('fans execution status to platform membership workspaces with deterministic dedupe keys', () => {
    const notifications = source('src/lib/platform/reset-notifications.ts');
    expect(notifications).toContain('activePlatformResetRecipients');
    expect(notifications).toContain('WorkspaceIds.PLATFORM_ADMIN');
    expect(notifications).toContain('notifyPlatformResetExecution');
    expect(notifications).toContain('tenant_reset_${input.status}_platform:');
  });

  it('keeps unresolved required actions represented in the dashboard bell count', () => {
    const api = source('src/app/api/notifications/route.ts');
    expect(api).toContain("item.status === 'action_required'");
    expect(api).toContain('actionRequiredCount');
    expect(api).toContain('attentionCount');

    const topbar = source('src/components/layout/topbar.tsx');
    expect(topbar).toContain('notificationQuery.data?.attentionCount');
    expect(topbar).toContain('requiring attention');
  });
});

describe('public live demo consistency', () => {
  it('uses the shared public hero and container without the legacy eyebrow', () => {
    const page = source('src/app/(public)/demo/page.tsx');
    expect(page).toContain('<PageHero');
    expect(page).toContain('<SectionContainer>');
    expect(page).not.toContain('GRN Fleet live demo');
    expect(page).not.toContain('max-w-5xl');
    expect(page).not.toContain('text-teal-300');
    expect(page).toContain('Live demo temporarily unavailable');
    expect(page).toContain('Request a Demo');
  });

  it('keeps the live demo reachable without an authenticated dashboard session', () => {
    const proxy = source('src/proxy.ts');
    expect(proxy).toContain("'/demo'");
  });
});
