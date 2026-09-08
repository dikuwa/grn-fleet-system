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
const notificationRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);

describe('notification dedupe tenant scope', () => {
  it('enforces dedupe uniqueness within a tenant rather than globally', () => {
    expect(schema).toContain("uniqueIndex('notifications_tenant_dedupe_key_idx')");
    expect(schema).toContain('table.tenantId,');
    expect(schema).toContain('table.dedupeKey,');
    expect(schema).not.toContain("uniqueIndex('notifications_dedupe_key_idx').on(table.dedupeKey)");
  });

  it('replaces the legacy index under a write lock', () => {
    const lockIndex = migration.indexOf('LOCK TABLE notifications');
    const dropIndex = migration.indexOf('DROP INDEX IF EXISTS notifications_dedupe_key_idx');
    const createIndex = migration.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS');

    expect(lockIndex).toBeGreaterThan(-1);
    expect(migration).toContain('IN SHARE ROW EXCLUSIVE MODE');
    expect(dropIndex).toBeGreaterThan(lockIndex);
    expect(createIndex).toBeGreaterThan(dropIndex);
    expect(migration).toContain('notifications_tenant_dedupe_key_idx');
    expect(migration).toContain('ON notifications (tenant_id, dedupe_key)');
  });

  it('keeps canonical dedupe tokens tenant-local at the database boundary', () => {
    const builderIndex = notificationService.indexOf('export function buildNotificationDedupeKey');
    const scopedCreateIndex = notificationService.indexOf('export async function createScopedNotifications');
    const builder = notificationService.slice(builderIndex, scopedCreateIndex);

    expect(builderIndex).toBeGreaterThan(-1);
    expect(builder).toContain('input.recipientUserId');
    expect(builder).not.toContain('tenantId');
    expect(notificationService).toContain('tenantId: input.tenantId');
    expect(notificationService).toContain('.onConflictDoNothing()');
  });

  it('targets the composite key where cancellation uses an explicit conflict target', () => {
    expect(requestLifecycle).toContain(
      '.onConflictDoNothing({ target: [notifications.tenantId, notifications.dedupeKey] })',
    );
    expect(requestLifecycle).not.toContain(
      '.onConflictDoNothing({ target: notifications.dedupeKey })',
    );
  });

  it('protects caller-supplied API dedupe tokens with tenant-scoped uniqueness', () => {
    const postIndex = notificationRoute.indexOf('export async function POST');
    const deleteIndex = notificationRoute.indexOf('export async function DELETE');
    const postRoute = notificationRoute.slice(postIndex, deleteIndex);

    expect(postRoute).toContain('dedupeKey: body.dedupeKey || null');
    expect(postRoute).toContain('tenantId,');
    expect(postRoute).toContain('.onConflictDoNothing()');
  });
});
