import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const route = readFileSync(
  resolve(process.cwd(), 'src/app/api/notifications/route.ts'),
  'utf8',
);

const postIndex = route.indexOf('export async function POST');
const deleteIndex = route.indexOf('export async function DELETE');
const postRoute = route.slice(postIndex, deleteIndex);
const insertIndex = postRoute.indexOf('.insert(notifications)');

describe('notification POST metadata validation', () => {
  it('rejects malformed entity UUIDs before notification persistence', () => {
    const guardIndex = postRoute.indexOf("{ error: 'Invalid notification entity ID' }");

    expect(guardIndex).toBeGreaterThan(-1);
    expect(postRoute.slice(0, guardIndex)).toContain('!UUID_PATTERN.test(entityId)');
    expect(guardIndex).toBeLessThan(insertIndex);
  });

  it('accepts only registered workspace identifiers before persistence', () => {
    const workspaceIndex = postRoute.indexOf('const notificationWorkspace = body.workspace || null;');
    const guardIndex = postRoute.indexOf("{ error: 'Invalid notification workspace' }");

    expect(route).toContain("import { isWorkspaceId } from '@/lib/workspaces';");
    expect(workspaceIndex).toBeGreaterThan(-1);
    expect(postRoute.slice(workspaceIndex, guardIndex)).toContain(
      '!isWorkspaceId(notificationWorkspace)',
    );
    expect(guardIndex).toBeLessThan(insertIndex);
    expect(postRoute).toContain('workspace: notificationWorkspace');
  });

  it('restricts priority while preserving the urgent compatibility alias', () => {
    const guardIndex = postRoute.indexOf("{ error: 'Invalid notification priority' }");

    expect(route).toContain(
      "const NOTIFICATION_PRIORITIES = new Set(['low', 'normal', 'high', 'emergency']);",
    );
    expect(postRoute).toContain("const priorityValue = priority || 'normal';");
    expect(postRoute).toContain(
      "const normalizedPriority = priorityValue === 'urgent' ? 'emergency' : priorityValue;",
    );
    expect(postRoute.slice(0, guardIndex)).toContain(
      '!NOTIFICATION_PRIORITIES.has(normalizedPriority)',
    );
    expect(guardIndex).toBeLessThan(insertIndex);
    expect(postRoute).toContain('priority: normalizedPriority');
    expect(postRoute).toContain(
      "const isHighPriority = normalizedPriority === 'high' || normalizedPriority === 'emergency';",
    );
  });

  it('requires event versions to be positive safe integers while preserving the default', () => {
    const versionIndex = postRoute.indexOf('let eventVersion = 1;');
    const guardIndex = postRoute.indexOf("{ error: 'Invalid notification event version' }");

    expect(versionIndex).toBeGreaterThan(-1);
    expect(postRoute.slice(versionIndex, guardIndex)).toContain(
      'Number.isSafeInteger(parsedEventVersion)',
    );
    expect(postRoute.slice(versionIndex, guardIndex)).toContain('parsedEventVersion < 1');
    expect(guardIndex).toBeLessThan(insertIndex);
    expect(postRoute).toContain('eventVersion,');
    expect(postRoute).not.toContain('eventVersion: Number(body.eventVersion) || 1');
  });
});
