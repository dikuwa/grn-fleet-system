import { describe, expect, it } from 'vitest';
import { type SQL } from 'drizzle-orm';
import { activeApprovalVisibleTo } from './approval-queue';
import { Permissions } from './permissions';

/** Render a drizzle SQL condition to a readable string for assertions. */
function render(condition: SQL): string {
  return condition.queryChunks
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk;
      if (Array.isArray(chunk)) {
        return chunk
          .map((item) => {
            if (typeof item === 'string') return item;
            const param = (item as { value?: unknown }).value;
            return param === undefined ? String(item) : String(param);
          })
          .join(', ');
      }
      const candidate = chunk as { value?: unknown; name?: string; queryChunks?: unknown[] };
      if (candidate.value !== undefined) return String(candidate.value);
      if (candidate.name) return candidate.name;
      if (Array.isArray(candidate.queryChunks)) return render(chunk as unknown as SQL);
      return Object.prototype.toString.call(chunk);
    })
    .join(' ');
}

function sqlFor(userId: string, permissions: readonly string[]) {
  return render(activeApprovalVisibleTo(userId, permissions as never));
}

describe('activeApprovalVisibleTo', () => {
  it('always includes the explicit assignment branch', () => {
    const sql = sqlFor('user-1', [Permissions.REQUEST_REVIEW_TRANSPORT]);
    expect(sql).toContain('assigned_user_id');
    expect(sql).toContain('user-1');
  });

  it('adds the permission branch when the user holds the step permission', () => {
    const sql = sqlFor('user-1', [Permissions.REQUEST_REVIEW_TRANSPORT]);
    expect(sql).toContain('required_permission');
    expect(sql).toContain(Permissions.REQUEST_REVIEW_TRANSPORT);
  });

  it('does not grant permission-routed visibility for permissions the user lacks', () => {
    const sql = sqlFor('user-1', [Permissions.DRIVER_LOG_CREATE]);
    expect(sql).not.toContain(Permissions.REQUEST_REVIEW_TRANSPORT);
  });

  it('falls back to assignment-only when the user holds no permissions', () => {
    const sql = sqlFor('user-1', []);
    expect(sql).toContain('assigned_user_id');
    expect(sql).not.toContain('required_permission');
  });

  it('keeps the permission branch anchored to unassigned steps', () => {
    const sql = sqlFor('user-1', [Permissions.REQUEST_APPROVE_SUPERVISOR]);
    const assignedIndex = sql.indexOf('assigned_user_id');
    const permissionIndex = sql.indexOf('required_permission');
    expect(assignedIndex).toBeGreaterThanOrEqual(0);
    expect(permissionIndex).toBeGreaterThan(assignedIndex);
  });
});
