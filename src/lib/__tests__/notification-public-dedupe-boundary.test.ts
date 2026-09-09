import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);
const notificationService = readFileSync(
  resolve(process.cwd(), 'src/lib/notification-service.ts'),
  'utf8',
);
const quarantineMigration = readFileSync(
  resolve(
    process.cwd(),
    'src/db/migrations/0119_notification_dedupe_legacy_quarantine.sql',
  ),
  'utf8',
);

const postIndex = route.indexOf('export async function POST');
const deleteIndex = route.indexOf('export async function DELETE');
const postRoute = route.slice(postIndex, deleteIndex);

describe('notification public dedupe boundary', () => {
  it('never persists caller-supplied dedupe keys from the public API', () => {
    expect(postIndex).toBeGreaterThan(-1);
    expect(deleteIndex).toBeGreaterThan(postIndex);
    expect(postRoute).toContain('dedupeKey: null');
    expect(postRoute).not.toContain('dedupeKey: body.dedupeKey');
    expect(postRoute).not.toContain('publicDedupeKey');
    expect(postRoute).not.toContain('api:${tenantId}');
  });

  it('quarantines historical non-null dedupe keys under a write-blocking lock', () => {
    expect(quarantineMigration).toContain(
      'LOCK TABLE notifications IN SHARE ROW EXCLUSIVE MODE;',
    );
    expect(quarantineMigration).toContain(
      "SET dedupe_key = 'legacy-quarantine:v1:' || dedupe_key",
    );
    expect(quarantineMigration).toContain('WHERE dedupe_key IS NOT NULL');
    expect(quarantineMigration).toContain(
      "dedupe_key NOT LIKE 'legacy-quarantine:v1:%'",
    );
    expect(quarantineMigration).not.toContain('DELETE FROM notifications');
    expect(quarantineMigration).not.toContain('DROP INDEX');
  });

  it('keeps internal workflow dedupe generation unchanged and outside the quarantine namespace', () => {
    const builderStart = notificationService.indexOf('export function buildNotificationDedupeKey');
    const builderEnd = notificationService.indexOf('export async function createScopedNotifications');
    const builder = notificationService.slice(builderStart, builderEnd);

    expect(builderStart).toBeGreaterThan(-1);
    expect(builderEnd).toBeGreaterThan(builderStart);
    expect(builder).toContain('input.recipientUserId');
    expect(builder).not.toContain('api:');
    expect(builder).not.toContain('legacy-quarantine:v1:');
  });
});
