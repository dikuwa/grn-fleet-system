import { describe, expect, it } from 'vitest';
import {
  currentNamibiaDate,
  validateMaintenanceServiceDate,
  validateNextServiceOdometer,
} from '@/lib/maintenance-record-validation';

describe('maintenance record validation', () => {
  it('resolves the operational date in Namibia around UTC midnight', () => {
    expect(currentNamibiaDate(new Date('2026-08-15T22:30:00.000Z'))).toBe('2026-08-16');
  });

  it('rejects future service history while allowing the current Namibia date', () => {
    const now = new Date('2026-08-16T10:00:00.000Z');
    expect(validateMaintenanceServiceDate('2026-08-16', now)).toBeNull();
    expect(validateMaintenanceServiceDate('2026-08-17', now)).toBe('Service date cannot be in the future');
  });

  it('uses the recorded service odometer as the reminder baseline when present', () => {
    expect(validateNextServiceOdometer({
      nextServiceOdometer: 49_999,
      serviceOdometer: 50_000,
      currentVehicleOdometer: 48_000,
    })).toBe('Next service odometer cannot be below the service odometer');
  });

  it('uses the current vehicle odometer as the reminder baseline when service odometer is omitted', () => {
    expect(validateNextServiceOdometer({
      nextServiceOdometer: 47_999,
      serviceOdometer: null,
      currentVehicleOdometer: 48_000,
    })).toBe('Next service odometer cannot be below the current vehicle odometer');
  });
});
