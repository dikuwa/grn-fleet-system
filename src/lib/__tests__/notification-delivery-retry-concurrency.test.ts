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

  it('re-proves active tenant membership before resolving or sending to a recipient', () => {
    const membershipIndex = retryRoute.indexOf('const [activeMembership] = await db');
    const employeeIndex = retryRoute.indexOf('const [employee] = await db', membershipIndex);
    const resendIndex = retryRoute.indexOf('const resend = new Resend(resendApiKey)');

    expect(retryRoute).toContain("import { tenantMemberships } from '@/db/schema/tenants'");
    expect(membershipIndex).toBeGreaterThan(-1);
    expect(retryRoute).toContain('eq(tenantMemberships.tenantId, session.tenantId)');
    expect(retryRoute).toContain('eq(tenantMemberships.userId, delivery.notification.recipientUserId)');
    expect(retryRoute).toContain("eq(tenantMemberships.status, 'active')");
    expect(employeeIndex).toBeGreaterThan(membershipIndex);
    expect(resendIndex).toBeGreaterThan(employeeIndex);
    expect(retryRoute).toContain('Notification recipient is no longer an active tenant member');
  });

  it('persists an immutable predecessor claim before crossing the external email boundary', () => {
    const reservationIndex = retryRoute.indexOf('.insert(notificationDeliveries)');
    const resendIndex = retryRoute.indexOf('const resend = new Resend(resendApiKey)');

    expect(reservationIndex).toBeGreaterThan(-1);
    expect(resendIndex).toBeGreaterThan(reservationIndex);
    expect(retryRoute).toContain('retryOfDeliveryId: delivery.id');
    expect(retryRoute).toContain("status: 'pending'");
    expect(retryRoute).toContain('.onConflictDoNothing()');
    expect(retryRoute).toContain('A retry has already been claimed for this delivery. Refresh delivery history.');
  });

  it('recovers only the pending retry child of the requested failed delivery', () => {
    expect(retryRoute).toContain('createdAt: notificationDeliveries.createdAt');
    expect(retryRoute).toContain('retryOfDeliveryId: notificationDeliveries.retryOfDeliveryId');
    expect(retryRoute).toContain('const RETRY_PENDING_RECLAIM_MS = 15 * 60 * 1000');
    expect(retryRoute).toContain('const RESEND_IDEMPOTENCY_SAFE_WINDOW_MS = 23 * 60 * 60 * 1000');
    expect(retryRoute).toContain("latestDelivery?.status === 'pending'");
    expect(retryRoute).toContain('latestDelivery.attempt === delivery.attempt + 1');
    expect(retryRoute).toContain('latestDelivery.retryOfDeliveryId === delivery.id');
    expect(retryRoute).toContain('pendingAgeMs < RETRY_PENDING_RECLAIM_MS');
    expect(retryRoute).toContain('pendingAgeMs >= RESEND_IDEMPOTENCY_SAFE_WINDOW_MS');
    expect(retryRoute).toContain('reservedAttempt = existingPending');
  });

  it('uses a stable Resend idempotency key for fresh and recovered reservations', () => {
    const providerIndex = retryRoute.indexOf('const result = await resend.emails.send');
    const keyIndex = retryRoute.indexOf('idempotencyKey: `notification-delivery/${reservedAttempt.id}`');

    expect(providerIndex).toBeGreaterThan(-1);
    expect(keyIndex).toBeGreaterThan(providerIndex);
  });

  it('leaves a provider-concurrent reservation pending for later recovery', () => {
    const concurrentIndex = retryRoute.indexOf("deliveryErrorName(result.error) === 'concurrent_idempotent_requests'");
    const finalizationIndex = retryRoute.indexOf('.update(notificationDeliveries)', concurrentIndex);

    expect(concurrentIndex).toBeGreaterThan(-1);
    expect(retryRoute.slice(concurrentIndex, finalizationIndex)).toContain('{ status: 409 }');
    expect(finalizationIndex).toBeGreaterThan(concurrentIndex);
  });

  it('finalizes only the reserved retry child', () => {
    const providerIndex = retryRoute.indexOf('const result = await resend.emails.send');
    const finalizationIndex = retryRoute.indexOf('.update(notificationDeliveries)', providerIndex);

    expect(providerIndex).toBeGreaterThan(-1);
    expect(finalizationIndex).toBeGreaterThan(providerIndex);
    expect(retryRoute).toContain('eq(notificationDeliveries.id, reservedAttempt.id)');
    expect(retryRoute).toContain('eq(notificationDeliveries.retryOfDeliveryId, delivery.id)');
    expect(retryRoute).toContain("eq(notificationDeliveries.status, 'pending')");
  });

  it('enforces immutable retry-child and in-flight uniqueness in schema and migration', () => {
    expect(notificationSchema).toContain("retryOfDeliveryId: uuid('retry_of_delivery_id')");
    expect(notificationSchema).toContain('notification_deliveries_retry_predecessor_idx');
    expect(notificationSchema).toContain('notification_deliveries_one_pending_per_channel_idx');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "retry_of_delivery_id" uuid');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_retry_predecessor_idx"');
    expect(migration).toContain('ON "notification_deliveries" ("retry_of_delivery_id")');
    expect(migration).toContain('WHERE "retry_of_delivery_id" IS NOT NULL');
    expect(migration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_one_pending_per_channel_idx"');
    expect(migration).toContain('("notification_id", "channel")');
    expect(migration).toContain("WHERE \"status\" = 'pending'");
  });
});
