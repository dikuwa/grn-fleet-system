import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(
  resolve(process.cwd(), 'src/db/schema/notifications.ts'),
  'utf8',
);
const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0118_notification_preference_integrity.sql'),
  'utf8',
);

describe('notification preference integrity', () => {
  it('enforces one preference row per tenant/user in schema and migration', () => {
    expect(schema).toContain("uniqueIndex('notification_preferences_tenant_user_idx')");
    expect(schema).toContain('table.tenantId,');
    expect(schema).toContain('table.userId,');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_tenant_user_idx');
    expect(migration).toContain('ON notification_preferences (tenant_id, user_id)');
  });

  it('deduplicates deterministically before adding the unique index', () => {
    const rankIndex = migration.indexOf('ROW_NUMBER() OVER');
    const deleteIndex = migration.indexOf('DELETE FROM notification_preferences');
    const indexIndex = migration.indexOf('CREATE UNIQUE INDEX');

    expect(rankIndex).toBeGreaterThan(-1);
    expect(migration).toContain('PARTITION BY tenant_id, user_id');
    expect(migration).toContain('ORDER BY updated_at DESC, created_at DESC, id DESC');
    expect(deleteIndex).toBeGreaterThan(rankIndex);
    expect(indexIndex).toBeGreaterThan(deleteIndex);
    expect(migration).toContain('ranked.row_rank > 1');
  });

  it('uses one atomic insert-on-conflict update for preference writes', () => {
    const preferenceIndex = route.indexOf("if (action === 'update_preferences')");
    const returnIndex = route.indexOf('return NextResponse.json({ success: true });', preferenceIndex);
    const preferenceBlock = route.slice(preferenceIndex, returnIndex);

    expect(preferenceIndex).toBeGreaterThan(-1);
    expect(preferenceBlock).toContain('.insert(notificationPreferences)');
    expect(preferenceBlock).toContain('.onConflictDoUpdate({');
    expect(preferenceBlock).toContain(
      'target: [notificationPreferences.tenantId, notificationPreferences.userId]',
    );
    expect(preferenceBlock).not.toContain('.update(notificationPreferences)');
    expect(preferenceBlock).not.toContain('if (updated.length === 0)');
  });

  it('preserves existing preference defaults during the atomic upsert', () => {
    const preferenceIndex = route.indexOf("if (action === 'update_preferences')");
    const returnIndex = route.indexOf('return NextResponse.json({ success: true });', preferenceIndex);
    const preferenceBlock = route.slice(preferenceIndex, returnIndex);

    expect(preferenceBlock).toContain('quietHoursStart: quietHoursStart || null');
    expect(preferenceBlock).toContain('quietHoursEnd: quietHoursEnd || null');
    expect(preferenceBlock).toContain('emailNotifications: emailNotifications ?? true');
    expect(preferenceBlock).toContain('inAppNotifications: inAppNotifications ?? true');
    expect(preferenceBlock).toContain('updatedAt: new Date()');
  });
});
