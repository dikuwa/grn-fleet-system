import { describe, expect, it } from 'vitest';
import { calculateDriverCompliance, findDelegationConflicts } from './employee-lifecycle';

const eligible = {
  employeeStatus: 'active',
  availabilityStatus: 'available',
  driverStatus: 'authorised',
  licenceStatus: 'verified',
  licenceExpiry: '2027-12-31',
  licenceCodes: ['B', 'C1'],
  requiredLicenceClass: 'B',
  professionalRequired: false,
  tripEndAt: new Date('2026-08-10T10:00:00Z'),
};

describe('driver compliance', () => {
  it('requires the licence to remain valid through trip end', () => {
    const result = calculateDriverCompliance({ ...eligible, licenceExpiry: '2026-08-09' });
    expect(result.status).toBe('not_eligible');
    expect(result.reasons).toContain('Licence expires before the trip ends');
  });

  it('blocks the wrong configurable licence class', () => {
    const result = calculateDriverCompliance({ ...eligible, requiredLicenceClass: 'CE' });
    expect(result.status).toBe('not_eligible');
  });

  it('separates temporary unavailability from compliance failure', () => {
    expect(calculateDriverCompliance({ ...eligible, availabilityStatus: 'annual_leave' }).status)
      .toBe('temporarily_unavailable');
  });
});

describe('delegation conflicts', () => {
  it('detects overlapping role and employee appointments', () => {
    const conflicts = findDelegationConflicts({
      actingEmployeeId: 'employee-1',
      roleId: 'role-1',
      substantiveHolderEmployeeId: 'employee-2',
      startAt: new Date('2026-08-01'),
      endAt: new Date('2026-08-10'),
      actingEmployeeStatus: 'active',
      actingAvailability: 'available',
      existing: [{
        actingEmployeeId: 'employee-1',
        roleId: 'role-1',
        startAt: new Date('2026-08-05'),
        endAt: new Date('2026-08-12'),
        status: 'active',
      }],
    });
    expect(conflicts).toContain('This role already has an overlapping acting appointment');
    expect(conflicts).toContain('The acting employee has an overlapping delegation');
  });
});
