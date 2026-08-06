import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildNotificationDedupeKey,
  resolvePermissionRecipients,
  resolveRecipientIds,
} from './notification-service';

// Mock getDb so resolvePermissionRecipients can be tested against a fake
// role-assignment table without touching a real database.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rowsByCall: any[] = [];
vi.mock('@/db', () => ({
  getDb: () => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    then: vi.fn(async (resolve: (rows: unknown) => void) => resolve(rowsByCall.shift() ?? [])),
  }),
}));

beforeEach(() => {
  rowsByCall.length = 0;
});

describe('notification recipient and dedupe policy', () => {
  it('targets explicit accountable users without duplicates', () => {
    expect(
      resolveRecipientIds({
        ownerUserId: 'owner',
        requesterUserId: 'requester',
        participantUserIds: ['passenger', 'requester'],
        assignedUserIds: ['driver'],
        currentApproverUserId: 'approver',
      }),
    ).toEqual(['owner', 'requester', 'passenger', 'driver', 'approver']);
  });

  it('makes event identity recipient and workflow-stage specific', () => {
    const base = {
      recipientUserId: 'user-a',
      eventType: 'approval_assigned',
      entityType: 'request',
      entityId: 'request-a',
      workflowStage: 'supervisor',
      eventVersion: 1,
    };
    expect(buildNotificationDedupeKey(base)).toBe(buildNotificationDedupeKey(base));
    expect(buildNotificationDedupeKey(base)).not.toBe(
      buildNotificationDedupeKey({ ...base, recipientUserId: 'user-b' }),
    );
    expect(buildNotificationDedupeKey(base)).not.toBe(
      buildNotificationDedupeKey({ ...base, workflowStage: 'director' }),
    );
  });

  it('resolves active permission holders within their assignment window, deduped', async () => {
    const now = new Date();
    rowsByCall.push([
      { userId: 'user-a', startDate: new Date(now.getTime() - 86_400_000), endDate: null },
      { userId: 'user-b', startDate: new Date(now.getTime() - 86_400_000), endDate: null },
      // Duplicate row for the same user — must be deduped.
      { userId: 'user-a', startDate: new Date(now.getTime() - 86_400_000), endDate: null },
      // Outside the current assignment window — must be excluded.
      { userId: 'user-c', startDate: new Date(now.getTime() - 86_400_000), endDate: new Date(now.getTime() - 1_000) },
      { userId: 'user-d', startDate: new Date(now.getTime() + 86_400_000), endDate: null },
    ]);

    await expect(resolvePermissionRecipients('tenant-1', 'request:approve-supervisor')).resolves.toEqual(
      ['user-a', 'user-b'],
    );
  });
});
