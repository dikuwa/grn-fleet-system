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

  it('keeps internal workflow dedupe generation unchanged', () => {
    const builderStart = notificationService.indexOf('export function buildNotificationDedupeKey');
    const builderEnd = notificationService.indexOf('export async function createScopedNotifications');
    const builder = notificationService.slice(builderStart, builderEnd);

    expect(builderStart).toBeGreaterThan(-1);
    expect(builderEnd).toBeGreaterThan(builderStart);
    expect(builder).toContain('input.recipientUserId');
    expect(builder).not.toContain('api:');
  });
});
