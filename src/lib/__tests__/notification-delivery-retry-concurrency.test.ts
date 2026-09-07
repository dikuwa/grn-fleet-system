import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const retryRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/deliveries/[id]/retry/route.ts'),
  'utf8',
);
const notificationSchema = readFileSync(
  resolve(process.cwd(), 'src/db/schema/notifications.ts'),
  'utf8',
);
const migration = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0117_notification_delivery_retry_guard.sql'),
  'utf8',
);

describe('notification delivery retry concurrency contract', () => {
  it('rejects malformed delivery ids after authorization and before database access', () => {
    const permissionIndex = retryRoute.indexOf('const permCheck = await requireAnyPermission');
    const guardIndex = retryRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = retryRoute.indexOf('const db = getDb()');

    expect(retryRoute).toContain('const UUID_PATTERN =');
    expect(permissionIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(retryRoute).toContain("{ error: 'Delivery not found' }");
  });

  it('allows retry only from the latest failed attempt', () => {
    expect(retryRoute).toContain('.orderBy(desc(notificationDeliveries.attempt), desc(notificationDeliveries.createdAt))');
    expect(retryRoute).toContain("latestDelivery.id !== delivery.id || latestDelivery.status !== 'failed'");
    expect(retryRoute).toContain('This delivery is no longer the latest failed attempt. Refresh delivery history.');
  });

  it('reserves a pending attempt before crossing the external email boundary', () => {
    const reservationIndex = retryRoute.indexOf('const [reservedAttempt] = await db');
    const resendIndex = retryRoute.indexOf('const resend = new Resend(resendApiKey)');

    expect(reservationIndex).toBeGreaterThan(-1);
    expect(resendIndex).toBeGreaterThan(reservationIndex);
    expect(retryRoute).toContain("status: 'pending'");
    expect(retryRoute).toContain('.onConflictDoNothing()');
    expect(retryRoute).toContain('A retry is already in progress for this delivery. Refresh delivery history.');
  });

  it('finalizes the reserved attempt instead of inserting a second post-send row', () => {
    const providerIndex = retryRoute.indexOf('const result = await resend.emails.send');
    const finalizationIndex = retryRoute.indexOf('.update(notificationDeliveries)', providerIndex);

    expect(providerIndex).toBeGreaterThan(-1);
    expect(finalizationIndex).toBeGreaterThan(providerIndex);
    expect(retryRoute).toContain('eq(notificationDeliveries.id, reservedAttempt.id)');
    expect(retryRoute).toContain("eq(notificationDeliveries.status, 'pending')");
  });

  it('enforces one in-flight retry per notification and channel in schema and migration', () => {
    expect(notificationSchema).toContain('notification_deliveries_one_pending_per_channel_idx');
    expect(notificationSchema).toContain(".where(sql`${table.status} = 'pending'`)");
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_one_pending_per_channel_idx"');
    expect(migration).toContain('("notification_id", "channel")');
    expect(migration).toContain("WHERE \"status\" = 'pending'");
  });
});
