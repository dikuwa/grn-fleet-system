import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);

describe('notification API mutation and list boundaries', () => {
  it('distinguishes an omitted DELETE id from an explicitly malformed one', () => {
    const deleteIndex = route.indexOf('export async function DELETE');
    const hasIdIndex = route.indexOf("const hasNotificationId = searchParams.has('id')", deleteIndex);
    const guardIndex = route.indexOf(
      'if (hasNotificationId && (!notificationId || !UUID_PATTERN.test(notificationId)))',
      deleteIndex,
    );
    const singleMutationIndex = route.indexOf('if (hasNotificationId) {', guardIndex);

    expect(route).toContain('const UUID_PATTERN =');
    expect(deleteIndex).toBeGreaterThan(-1);
    expect(hasIdIndex).toBeGreaterThan(deleteIndex);
    expect(guardIndex).toBeGreaterThan(hasIdIndex);
    expect(singleMutationIndex).toBeGreaterThan(guardIndex);
    expect(route.slice(guardIndex, singleMutationIndex)).toContain(
      "{ error: 'Notification not found' }",
    );
  });

  it('distinguishes omitted PATCH ids from explicit falsy or malformed ids before database access', () => {
    const patchIndex = route.indexOf('export async function PATCH');
    const bodyIndex = route.indexOf('const body = await request.json()', patchIndex);
    const hasIdIndex = route.indexOf(
      "Object.prototype.hasOwnProperty.call(body, 'notificationId')",
      patchIndex,
    );
    const guardIndex = route.indexOf(
      "typeof notificationId !== 'string' || !UUID_PATTERN.test(notificationId)",
      patchIndex,
    );
    const dbIndex = route.indexOf('const db = getDb()', patchIndex);
    const singleMutationIndex = route.indexOf('if (hasNotificationId) {', dbIndex);

    expect(bodyIndex).toBeGreaterThan(patchIndex);
    expect(hasIdIndex).toBeGreaterThan(bodyIndex);
    expect(guardIndex).toBeGreaterThan(hasIdIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(singleMutationIndex).toBeGreaterThan(dbIndex);
    expect(route.slice(guardIndex, dbIndex)).toContain("{ error: 'Notification not found' }");
  });

  it('bounds and validates notification list limits before database access', () => {
    const getIndex = route.indexOf('export async function GET');
    const rawLimitIndex = route.indexOf("const rawLimit = searchParams.get('limit')", getIndex);
    const formatGuardIndex = route.indexOf("if (rawLimit !== null && !/^\\d+$/.test(rawLimit))", getIndex);
    const safeIntegerGuardIndex = route.indexOf('!Number.isSafeInteger(parsedLimit)', getIndex);
    const clampIndex = route.indexOf('Math.min(parsedLimit, MAX_NOTIFICATION_LIMIT)', getIndex);
    const dbIndex = route.indexOf('const db = getDb()', getIndex);

    expect(route).toContain('const DEFAULT_NOTIFICATION_LIMIT = 50');
    expect(route).toContain('const MAX_NOTIFICATION_LIMIT = 200');
    expect(rawLimitIndex).toBeGreaterThan(getIndex);
    expect(formatGuardIndex).toBeGreaterThan(rawLimitIndex);
    expect(safeIntegerGuardIndex).toBeGreaterThan(formatGuardIndex);
    expect(clampIndex).toBeGreaterThan(safeIntegerGuardIndex);
    expect(dbIndex).toBeGreaterThan(clampIndex);
    expect(route).toContain("{ error: 'Invalid notification limit' }");
    expect(route).toContain('.limit(MAX_NOTIFICATION_LIMIT)');
  });

  it('protects only unresolved mandatory actions from single and bulk dismissal', () => {
    const deleteIndex = route.indexOf('export async function DELETE');
    const itemSelectIndex = route.indexOf('mandatory: notifications.mandatory', deleteIndex);
    const mandatoryGuardIndex = route.indexOf(
      "if (item.mandatory && item.status === 'action_required')",
      deleteIndex,
    );
    const bulkLifecycleIndex = route.indexOf(
      "or(eq(notifications.mandatory, false), ne(notifications.status, 'action_required'))!",
      mandatoryGuardIndex,
    );

    expect(itemSelectIndex).toBeGreaterThan(deleteIndex);
    expect(mandatoryGuardIndex).toBeGreaterThan(itemSelectIndex);
    expect(route.slice(mandatoryGuardIndex, bulkLifecycleIndex)).toContain(
      'Required action notifications cannot be dismissed until resolved',
    );
    expect(bulkLifecycleIndex).toBeGreaterThan(mandatoryGuardIndex);
    expect(
      route.match(
        /or\(eq\(notifications\.mandatory, false\), ne\(notifications\.status, 'action_required'\)\)!/g,
      )?.length,
    ).toBe(2);
    expect(route).toContain('// Apply the same lifecycle rule to visible shared notifications.');
  });

  it('keeps personal and shared bulk dismiss inside current visibility scope', () => {
    const deleteIndex = route.indexOf('export async function DELETE');
    const personalBulkIndex = route.indexOf(
      '// Clear every dismissible personal notification visible in the active',
      deleteIndex,
    );
    const sharedBulkIndex = route.indexOf(
      '// Apply the same lifecycle rule to visible shared notifications',
      personalBulkIndex,
    );
    const patchIndex = route.indexOf('export async function PATCH');
    const personalBulk = route.slice(personalBulkIndex, sharedBulkIndex);
    const workspacePredicate =
      'or(isNull(notifications.workspace), eq(notifications.workspace, activeWorkspace))';

    expect(personalBulkIndex).toBeGreaterThan(deleteIndex);
    expect(sharedBulkIndex).toBeGreaterThan(personalBulkIndex);
    expect(personalBulk).toContain(workspacePredicate);
    expect(personalBulk).toContain("ne(notifications.status, 'archived')");
    expect(personalBulk).toContain("ne(notifications.status, 'dismissed')");
    expect(route.slice(sharedBulkIndex, patchIndex)).toContain('userScopedCondition');
  });

  it('keeps personal and shared mark-all-read inside current visibility scope', () => {
    const patchIndex = route.indexOf('export async function PATCH');
    const personalReadIndex = route.indexOf('// Mark all personal notifications as read.', patchIndex);
    const sharedReadIndex = route.indexOf('const shared = await db', personalReadIndex);
    const personalRead = route.slice(personalReadIndex, sharedReadIndex);
    const workspacePredicate =
      'or(isNull(notifications.workspace), eq(notifications.workspace, activeWorkspace))';

    expect(personalReadIndex).toBeGreaterThan(patchIndex);
    expect(sharedReadIndex).toBeGreaterThan(personalReadIndex);
    expect(personalRead).toContain("ne(notifications.status, 'archived')");
    expect(personalRead).toContain("ne(notifications.status, 'dismissed')");
    expect(personalRead).toContain(workspacePredicate);
    expect(route.slice(sharedReadIndex)).toContain("ne(notifications.status, 'archived')");
    expect(route.slice(sharedReadIndex)).toContain("ne(notifications.status, 'dismissed')");
    expect(route.slice(sharedReadIndex)).toContain(workspacePredicate);
  });
});
