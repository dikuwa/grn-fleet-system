import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  resolve(process.cwd(), 'src/db/schema/notifications.ts'),
  'utf8',
);
const notificationService = readFileSync(
  resolve(process.cwd(), 'src/lib/notification-service.ts'),
  'utf8',
);
const requestLifecycle = readFileSync(
  resolve(process.cwd(), 'src/lib/request-lifecycle-notifications.ts'),
  'utf8',
);
const resetNotifications = readFileSync(
  resolve(process.cwd(), 'src/lib/platform/reset-notifications.ts'),
  'utf8',
);
const notificationRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);

describe('notification dedupe tenant-scope rollout preparation', () => {
  it('leaves the production database uniqueness model unchanged during compatibility stage', () => {
    expect(schema).toContain("uniqueIndex('notifications_dedupe_key_idx').on(table.dedupeKey)");
    expect(schema).not.toContain("uniqueIndex('notifications_tenant_dedupe_key_idx')");
  });

  it('keeps canonical dedupe tokens tenant-local in application semantics', () => {
    const builderIndex = notificationService.indexOf('export function buildNotificationDedupeKey');
    const builderEndIndex = notificationService.indexOf('\n}\n', builderIndex);
    const builder = notificationService.slice(builderIndex, builderEndIndex + 3);

    expect(builderIndex).toBeGreaterThan(-1);
    expect(builderEndIndex).toBeGreaterThan(builderIndex);
    expect(builder).toContain('input.recipientUserId');
    expect(builder).not.toContain('tenantId');
    expect(notificationService).toContain('tenantId: input.tenantId');
    expect(notificationService).toContain('.onConflictDoNothing()');
  });

  it('removes the rollout-sensitive explicit cancellation conflict target', () => {
    expect(requestLifecycle).toContain('.onConflictDoNothing()');
    expect(requestLifecycle).not.toContain(
      '.onConflictDoNothing({ target: notifications.dedupeKey })',
    );
    expect(requestLifecycle).not.toContain(
      '.onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })',
    );
  });

  it('scopes reset ready fallback updates to the tenant as well as the dedupe key', () => {
    const readyIndex = resetNotifications.indexOf('export async function notifyResetRequesterReady');
    const resolveIndex = resetNotifications.indexOf('export async function resolveTenantResetReadyNotification');
    const readyPath = resetNotifications.slice(readyIndex, resolveIndex);

    expect(readyIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(readyIndex);
    expect(readyPath).toContain('eq(notifications.tenantId, input.tenantId)');
    expect(readyPath).toContain('eq(notifications.dedupeKey, dedupeKey)');
    expect(readyPath).not.toContain('.where(eq(notifications.dedupeKey, dedupeKey))');
  });

  it('keeps public API inserts outside the internal dedupe uniqueness namespace', () => {
    const postIndex = notificationRoute.indexOf('export async function POST');
    const deleteIndex = notificationRoute.indexOf('export async function DELETE');
    const postRoute = notificationRoute.slice(postIndex, deleteIndex);

    expect(postIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(postIndex);
    expect(postRoute).toContain('dedupeKey: null');
    expect(postRoute).not.toContain('dedupeKey: body.dedupeKey');
    expect(postRoute).toContain('tenantId,');
    expect(postRoute).toContain('.onConflictDoNothing()');
  });
});
