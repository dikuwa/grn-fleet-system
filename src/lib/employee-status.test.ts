import { describe, it, expect } from 'vitest';
import {
  EMPLOYEE_STATUSES,
  normaliseEmployeeStatus,
  getEmployeeStatusDisplay,
  employeeStatusConfig,
  AVAILABILITY_OPTIONS,
  normaliseAvailability,
  getAvailabilityLabel,
  getAccountStatusDisplay,
  accountStatusConfig,
} from '@/lib/employee-status';

describe('normaliseEmployeeStatus', () => {
  it('normalises case variants to the canonical ACTIVE value', () => {
    expect(normaliseEmployeeStatus('ACTIVE')).toBe('active');
    expect(normaliseEmployeeStatus('Active')).toBe('active');
    expect(normaliseEmployeeStatus('active')).toBe('active');
    expect(normaliseEmployeeStatus('  active  ')).toBe('active');
  });

  it('normalises legacy values that semantically mean inactive', () => {
    expect(normaliseEmployeeStatus('on_leave')).toBe('inactive');
    expect(normaliseEmployeeStatus('retired')).toBe('inactive');
    expect(normaliseEmployeeStatus('contract_ended')).toBe('inactive');
    expect(normaliseEmployeeStatus('transferred')).toBe('inactive');
    expect(normaliseEmployeeStatus('deceased')).toBe('inactive');
    expect(normaliseEmployeeStatus('temporarily_unavailable')).toBe('inactive');
  });

  it('keeps canonical values unchanged', () => {
    for (const status of EMPLOYEE_STATUSES) {
      expect(normaliseEmployeeStatus(status)).toBe(status);
    }
  });

  it('returns null for unknown or blank values', () => {
    expect(normaliseEmployeeStatus('')).toBeNull();
    expect(normaliseEmployeeStatus('   ')).toBeNull();
    expect(normaliseEmployeeStatus('mystery-status')).toBeNull();
    expect(normaliseEmployeeStatus(null)).toBeNull();
    expect(normaliseEmployeeStatus(undefined)).toBeNull();
  });
});

describe('getEmployeeStatusDisplay', () => {
  it('renders a green Active badge for every active case variant', () => {
    for (const raw of ['ACTIVE', 'Active', 'active']) {
      const display = getEmployeeStatusDisplay(raw);
      expect(display.canonical).toBe('active');
      expect(display.label).toBe('Active');
      expect(display.variant).toBe('success');
    }
  });

  it('never colours raw text directly — unknown values are muted', () => {
    const display = getEmployeeStatusDisplay('SOME-RAW-TEXT');
    expect(display.canonical).toBeNull();
    expect(display.variant).toBe('default');
  });

  it('maps suspended and archived to distinct visual variants', () => {
    expect(getEmployeeStatusDisplay('suspended').variant).toBe('error');
    expect(getEmployeeStatusDisplay('archived').variant).toBe('default');
    expect(getEmployeeStatusDisplay('inactive').variant).toBe('warning');
  });

  it('exposes the shared config consumed by all pages', () => {
    expect(employeeStatusConfig.active.label).toBe('Active');
    expect(employeeStatusConfig.active.variant).toBe('success');
  });
});

describe('availability', () => {
  it('normalises availability values', () => {
    expect(normaliseAvailability('available')).toBe('available');
    expect(normaliseAvailability('Annual Leave')).toBe('annual_leave');
    expect(normaliseAvailability('official_travel')).toBe('official_travel');
    expect(normaliseAvailability('')).toBeNull();
    expect(normaliseAvailability(null)).toBeNull();
  });

  it('labels canonical availability values', () => {
    expect(getAvailabilityLabel('annual_leave')).toBe('Annual leave');
    expect(getAvailabilityLabel('available')).toBe('Available');
    expect(getAvailabilityLabel('bogus')).toBe('bogus');
  });

  it('lists every canonical option', () => {
    expect(AVAILABILITY_OPTIONS.map((option) => option.value)).toEqual([
      'available',
      'annual_leave',
      'sick_leave',
      'official_travel',
      'training',
      'off_duty',
      'temporarily_unavailable',
    ]);
  });
});

describe('account status', () => {
  it('maps account statuses to display config', () => {
    expect(getAccountStatusDisplay('active').label).toBe('Active');
    expect(getAccountStatusDisplay('active').variant).toBe('success');
    expect(getAccountStatusDisplay('suspended').label).toBe('Suspended');
    expect(getAccountStatusDisplay('pending_activation').label).toBe('Pending Activation');
    expect(getAccountStatusDisplay('disabled').label).toBe('Disabled');
    expect(getAccountStatusDisplay('locked').label).toBe('Locked');
  });

  it('falls back to "No account" for a missing status', () => {
    expect(getAccountStatusDisplay(null).label).toBe('No account');
  });

  it('exposes every canonical account status', () => {
    expect(Object.keys(accountStatusConfig)).toEqual([
      'active',
      'suspended',
      'pending_activation',
      'disabled',
      'locked',
    ]);
  });
});
