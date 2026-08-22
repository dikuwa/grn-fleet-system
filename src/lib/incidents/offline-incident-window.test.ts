import { describe, expect, it } from 'vitest';
import { canAcceptLateOfflineIncident } from './offline-incident-window';

const startedAt = new Date('2026-08-22T08:00:00.000Z');
const returnedAt = new Date('2026-08-22T12:00:00.000Z');

function baseInput() {
  return {
    tripStatus: 'closure_review',
    startedAt,
    returnedAt,
    closedAt: null,
    occurredAt: new Date('2026-08-22T10:00:00.000Z'),
    offlineCreatedAt: new Date('2026-08-22T10:05:00.000Z'),
    clientSyncId: 'offline-incident-1',
  };
}

describe('canAcceptLateOfflineIncident', () => {
  it('accepts an idempotent offline incident captured inside the completed journey window', () => {
    expect(canAcceptLateOfflineIncident(baseInput())).toBe(true);
  });

  it.each(['return_inspection', 'closure_review', 'closed'])(
    'accepts a valid offline replay after the trip advances to %s',
    (tripStatus) => {
      expect(canAcceptLateOfflineIncident({ ...baseInput(), tripStatus })).toBe(true);
    },
  );

  it('rejects ordinary online late reporting through this exception', () => {
    expect(canAcceptLateOfflineIncident({ ...baseInput(), clientSyncId: null })).toBe(false);
    expect(canAcceptLateOfflineIncident({ ...baseInput(), offlineCreatedAt: null })).toBe(false);
  });

  it('rejects an incident occurrence outside the actual journey window', () => {
    expect(
      canAcceptLateOfflineIncident({
        ...baseInput(),
        occurredAt: new Date('2026-08-22T12:01:00.000Z'),
      }),
    ).toBe(false);
  });

  it('rejects a draft created after vehicle return even when the claimed occurrence is earlier', () => {
    expect(
      canAcceptLateOfflineIncident({
        ...baseInput(),
        offlineCreatedAt: new Date('2026-08-22T12:01:00.000Z'),
      }),
    ).toBe(false);
  });

  it.each(['pending', 'in_progress', 'return_due', 'cancelled'])(
    'does not use the late-reporting exception for %s trips',
    (tripStatus) => {
      expect(canAcceptLateOfflineIncident({ ...baseInput(), tripStatus })).toBe(false);
    },
  );

  it('uses closedAt only when no returnedAt timestamp exists', () => {
    expect(
      canAcceptLateOfflineIncident({
        ...baseInput(),
        returnedAt: null,
        closedAt: new Date('2026-08-22T12:00:00.000Z'),
      }),
    ).toBe(true);
  });
});
