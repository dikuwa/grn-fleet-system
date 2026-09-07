import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);

describe('notification mutation id boundaries', () => {
  it('guards malformed DELETE ids before notification UUID predicates', () => {
    const deleteIndex = route.indexOf('export async function DELETE');
    const guardIndex = route.indexOf('if (notificationId && !UUID_PATTERN.test(notificationId))', deleteIndex);
    const uuidPredicateIndex = route.indexOf('eq(notifications.id, notificationId)', deleteIndex);

    expect(route).toContain('const UUID_PATTERN =');
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(guardIndex).toBeGreaterThan(deleteIndex);
    expect(uuidPredicateIndex).toBeGreaterThan(guardIndex);
    expect(route.slice(guardIndex, uuidPredicateIndex)).toContain("{ error: 'Notification not found' }");
  });

  it('guards malformed PATCH ids before workspace and UUID-backed notification lookup', () => {
    const patchIndex = route.indexOf('export async function PATCH');
    const bodyIndex = route.indexOf('const body = await request.json()', patchIndex);
    const guardIndex = route.indexOf("typeof notificationId !== 'string' || !UUID_PATTERN.test(notificationId)", patchIndex);
    const dbIndex = route.indexOf('const db = getDb()', patchIndex);
    const uuidPredicateIndex = route.indexOf('eq(notifications.id, notificationId)', patchIndex);

    expect(bodyIndex).toBeGreaterThan(patchIndex);
    expect(guardIndex).toBeGreaterThan(bodyIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(uuidPredicateIndex).toBeGreaterThan(dbIndex);
    expect(route.slice(guardIndex, dbIndex)).toContain("{ error: 'Notification not found' }");
  });

  it('preserves bulk dismiss and mark-all-read paths without requiring an id', () => {
    expect(route).toContain('if (notificationId) {');
    expect(route).toContain('} else if (userId && tenantId) {');
    expect(route).toContain('// Clear only eligible informational notifications. Mandatory action');
  });
});
