import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
vi.mock('@/db', () => ({
  getDb: () => ({ execute }),
}));

import {
  OPERATION_DERIVED_AVAILABILITY_STATUSES,
  OPERATION_DERIVED_VEHICLE_STATUSES,
  reconcileTenantOperationalResetState,
} from './post-operational-reset';

describe('post operational reset reconciliation', () => {
  beforeEach(() => {
    execute.mockReset();
  });

  it('only declares operation-derived states as releasable', () => {
    expect(OPERATION_DERIVED_VEHICLE_STATUSES).toEqual([
      'provisional',
      'allocated',
      'issued',
      'in_use',
      'return_inspection',
    ]);
    expect(OPERATION_DERIVED_VEHICLE_STATUSES).not.toContain('maintenance');
    expect(OPERATION_DERIVED_VEHICLE_STATUSES).not.toContain('out_of_service');
    expect(OPERATION_DERIVED_VEHICLE_STATUSES).not.toContain('written_off');

    expect(OPERATION_DERIVED_AVAILABILITY_STATUSES).toEqual(['assigned', 'on_trip']);
    expect(OPERATION_DERIVED_AVAILABILITY_STATUSES).not.toContain('unavailable');
    expect(OPERATION_DERIVED_AVAILABILITY_STATUSES).not.toContain('leave');
  });

  it('reconciles notifications, vehicles, driver profiles and employee availability', async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ id: 'notification-1' }, { id: 'notification-2' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'vehicle-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'driver-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'employee-1' }] });

    await expect(reconcileTenantOperationalResetState('tenant-1')).resolves.toEqual({
      notificationsRemoved: 2,
      vehiclesReleased: 1,
      driversReleased: 1,
      employeesReleased: 1,
    });
    expect(execute).toHaveBeenCalledTimes(4);
  });
});
