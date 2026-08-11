import { describe, expect, it } from 'vitest';
import { getExceededPackageLimits, type UsageCounters } from './subscriptions';

const usage: UsageCounters = {
  vehicles: 25,
  users: 24,
  drivers: 12,
  departments: 4,
  offices: 2,
  storageGb: 0,
};

describe('getExceededPackageLimits', () => {
  it('accepts usage at or below every package limit', () => {
    expect(getExceededPackageLimits(usage, {
      maxVehicles: 25,
      maxUsers: 25,
      maxDrivers: 12,
      maxDepartments: 4,
      maxOffices: 2,
    })).toEqual([]);
  });

  it('reports every live usage category that exceeds a package limit', () => {
    expect(getExceededPackageLimits(usage, {
      maxVehicles: 20,
      maxUsers: 10,
      maxDrivers: 10,
      maxDepartments: 3,
      maxOffices: 1,
    })).toEqual(['vehicles', 'users', 'drivers', 'departments', 'offices']);
  });

  it('treats null limits as unlimited', () => {
    expect(getExceededPackageLimits(usage, {
      maxVehicles: null,
      maxUsers: null,
      maxDrivers: null,
      maxDepartments: null,
      maxOffices: null,
    })).toEqual([]);
  });
});
