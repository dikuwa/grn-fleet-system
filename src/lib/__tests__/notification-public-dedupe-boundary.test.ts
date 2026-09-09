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
  it('namespaces caller-supplied dedupe keys by API and authenticated tenant', () => {
    expect(postRoute).toContain('let publicDedupeKey: string | null = null;');
    expect(postRoute).toContain("typeof body.dedupeKey !== 'string'");
    expect(postRoute).toContain("{ error: 'Invalid notification dedupe key' }");
    expect(postRoute).toContain('publicDedupeKey = `api:${tenantId}:${body.dedupeKey}`;');
    expect(postRoute).toContain('dedupeKey: publicDedupeKey');
    expect(postRoute).not.toContain('dedupeKey: body.dedupeKey || null');
  });

  it('keeps internal workflow dedupe generation outside the public API namespace', () => {
    const builderStart = notificationService.indexOf('export function buildNotificationDedupeKey');
    const builderEnd = notificationService.indexOf('export async function createScopedNotifications');
    const builder = notificationService.slice(builderStart, builderEnd);

    expect(builderStart).toBeGreaterThan(-1);
    expect(builderEnd).toBeGreaterThan(builderStart);
    expect(builder).toContain('input.recipientUserId');
    expect(builder).not.toContain('api:');
  });
});
