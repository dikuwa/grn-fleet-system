import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  resolve(process.cwd(), 'src/db/schema/notifications.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0119_notification_dedupe_tenant_scope.sql'),
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

describe('notification dedupe tenant-scope migration', () => {
  it('models dedupe uniqueness by tenant and key', () => {
    expect(schema).toContain("uniqueIndex('notifications_tenant_dedupe_key_idx')");
    expect(schema).toContain('table.tenantId,');
    expect(schema).toContain('table.dedupeKey,');
    expect(schema).not.toContain("uniqueIndex('notifications_dedupe_key_idx').on(table.dedupeKey)");
  });

  it('replaces the legacy global index under a write lock', () => {
    const lockIndex = migration.indexOf('LOCK TABLE notifications');
    const dropIndex = migration.indexOf('DROP INDEX IF EXISTS notifications_dedupe_key_idx');
    const createIndex = migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS');

    expect(lockIndex).toBeGreaterThan(-1);
    expect(migration).toContain('IN SHARE ROW EXCLUSIVE MODE');
    expect(dropIndex).toBeGreaterThan(lockIndex);
    expect(createIndex).toBeGreaterThan(dropIndex);
    expect(migration).toContain('notifications_tenant_dedupe_key_idx');
    expect(migration).toContain('ON notifications (tenant_id, dedupe_key)');
    expect(migration).toContain('WHERE dedupe_key IS NOT NULL');
  });

  it('requires the compatibility writers to remain conflict-target agnostic', () => {
    expect(notificationService).toContain('.onConflictDoNothing()');
    expect(requestLifecycle).toContain('.onConflictDoNothing()');
    expect(requestLifecycle).not.toContain(
      '.onConflictDoNothing({ target: notifications.dedupeKey })',
    );
    expect(requestLifecycle).not.toContain(
      '.onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })',
    );

    const postIndex = notificationRoute.indexOf('export async function POST');
    const deleteIndex = notificationRoute.indexOf('export async function DELETE');
    const postRoute = notificationRoute.slice(postIndex, deleteIndex);
    expect(postRoute).toContain('.onConflictDoNothing()');
  });

  it('keeps reset-ready fallback updates tenant-scoped after global uniqueness is removed', () => {
    const readyIndex = resetNotifications.indexOf('export async function notifyResetRequesterReady');
    const resolveIndex = resetNotifications.indexOf('export async function resolveTenantResetReadyNotification');
    const readyPath = resetNotifications.slice(readyIndex, resolveIndex);

    expect(readyIndex).toBeGreaterThan(-1);
    expect(resolveIndex).toBeGreaterThan(readyIndex);
    expect(readyPath).toContain('eq(notifications.tenantId, input.tenantId)');
    expect(readyPath).toContain('eq(notifications.dedupeKey, dedupeKey)');
    expect(readyPath).not.toContain('.where(eq(notifications.dedupeKey, dedupeKey))');
  });

  it('allows identical logical dedupe keys to be isolated by tenant at the database boundary', () => {
    expect(migration).not.toContain('ON notifications (dedupe_key)');
    expect(migration).toContain('ON notifications (tenant_id, dedupe_key)');
  });
});
