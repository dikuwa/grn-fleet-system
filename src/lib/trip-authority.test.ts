import { describe, expect, it } from 'vitest';
import {
  assertAuthorityTransition,
  canTransitionAuthority,
  maskLicenceNumber,
} from '@/lib/trip-authority';

describe('Trip Authority lifecycle', () => {
  it('enforces the normal driver lifecycle', () => {
    expect(canTransitionAuthority('awaiting_driver_acceptance', 'driver_accepted')).toBe(true);
    expect(canTransitionAuthority('driver_accepted', 'awaiting_pre_trip_inspection')).toBe(true);
    expect(canTransitionAuthority('awaiting_pre_trip_inspection', 'ready_for_departure')).toBe(true);
    expect(canTransitionAuthority('ready_for_departure', 'in_progress')).toBe(true);
    expect(canTransitionAuthority('in_progress', 'returned')).toBe(true);
    expect(canTransitionAuthority('returned', 'awaiting_arrival_inspection')).toBe(true);
    expect(canTransitionAuthority('awaiting_reconciliation', 'completed')).toBe(true);
    expect(canTransitionAuthority('completed', 'closed')).toBe(true);
  });

  it('blocks unsafe status skips and terminal reuse', () => {
    expect(canTransitionAuthority('awaiting_driver_acceptance', 'in_progress')).toBe(false);
    expect(canTransitionAuthority('in_progress', 'closed')).toBe(false);
    expect(canTransitionAuthority('cancelled', 'in_progress')).toBe(false);
    expect(canTransitionAuthority('expired', 'ready_for_departure')).toBe(false);
    expect(() => assertAuthorityTransition('ready_for_departure', 'closed')).toThrow(
      /cannot move/,
    );
  });

  it('masks licence numbers for official presentation', () => {
    expect(maskLicenceNumber('N12345678')).toBe('*****5678');
    expect(maskLicenceNumber('1234')).toBe('****');
  });
});
