import { describe, expect, it } from 'vitest';
import { buildNotificationDedupeKey, resolveRecipientIds } from './notification-service';

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
});
