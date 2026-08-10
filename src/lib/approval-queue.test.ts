import { afterEach, describe, expect, it, vi } from 'vitest';
import { type SQL } from 'drizzle-orm';
import { activeApprovalVisibleTo, resolveActionableApprovalInstanceIds } from './approval-queue';
import { Permissions } from './permissions';
import { WorkflowEngine } from './workflow-engine';

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

describe('resolveActionableApprovalInstanceIds', () => {
  afterEach(() => vi.restoreAllMocks());

  function candidateDb(ids: string[]) {
    const db = {
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      innerJoin: vi.fn().mockReturnThis(),
      where: vi.fn().mockResolvedValue(ids.map((id) => ({ id }))),
    };
    return db;
  }

  it('includes a runtime acting holder even when the static candidate assignment is stale', async () => {
    const db = candidateDb(['workflow-acting']);
    vi.spyOn(WorkflowEngine.prototype, 'getWorkflowStatus').mockResolvedValue({
      instance: { status: 'active' },
      currentStep: {
        actionType: 'release',
        assignedUserId: 'acting-user',
        requiredPermission: Permissions.VEHICLE_RELEASE_REGIONAL,
      },
    } as never);

    await expect(
      resolveActionableApprovalInstanceIds({
        db: db as never,
        tenantId: 'tenant-1',
        userId: 'acting-user',
        permissionCodes: [Permissions.VEHICLE_RELEASE_REGIONAL],
      }),
    ).resolves.toEqual(['workflow-acting']);
  });

  it('does not fan an explicitly resolved approval out to unrelated permission holders', async () => {
    const db = candidateDb(['workflow-holder']);
    vi.spyOn(WorkflowEngine.prototype, 'getWorkflowStatus').mockResolvedValue({
      instance: { status: 'active' },
      currentStep: {
        actionType: 'release',
        assignedUserId: 'responsible-user',
        requiredPermission: Permissions.VEHICLE_RELEASE_REGIONAL,
      },
    } as never);

    await expect(
      resolveActionableApprovalInstanceIds({
        db: db as never,
        tenantId: 'tenant-1',
        userId: 'unrelated-user',
        permissionCodes: [Permissions.VEHICLE_RELEASE_REGIONAL],
      }),
    ).resolves.toEqual([]);
  });

  it('never includes acknowledgement stages in generic approvals', async () => {
    const db = candidateDb(['workflow-ack']);
    vi.spyOn(WorkflowEngine.prototype, 'getWorkflowStatus').mockResolvedValue({
      instance: { status: 'active' },
      currentStep: {
        actionType: 'acknowledge',
        assignedUserId: 'driver-user',
        requiredPermission: Permissions.DRIVER_LOG_CREATE,
      },
    } as never);

    await expect(
      resolveActionableApprovalInstanceIds({
        db: db as never,
        tenantId: 'tenant-1',
        userId: 'driver-user',
        permissionCodes: [Permissions.DRIVER_LOG_CREATE],
      }),
    ).resolves.toEqual([]);
  });
});
