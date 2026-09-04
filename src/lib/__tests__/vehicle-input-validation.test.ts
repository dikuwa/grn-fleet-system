import { describe, expect, it } from 'vitest';
import {
  parseOptionalIsoDate,
  parseOptionalNonNegativeInteger,
  VehicleInputValidationError,
} from '@/lib/vehicle-input-validation';

describe('vehicle input validation', () => {
  it('accepts empty optional values and valid non-negative whole numbers', () => {
    expect(parseOptionalNonNegativeInteger(undefined, 'Tare weight')).toBeNull();
    expect(parseOptionalNonNegativeInteger('', 'Tare weight')).toBeNull();
    expect(parseOptionalNonNegativeInteger('0', 'Tare weight')).toBe(0);
    expect(parseOptionalNonNegativeInteger('1250', 'Tare weight')).toBe(1250);
  });

  it('rejects malformed, fractional, and negative integer values', () => {
    for (const value of ['abc', '12.5', -1]) {
      expect(() => parseOptionalNonNegativeInteger(value, 'Tare weight')).toThrow(
        VehicleInputValidationError,
      );
    }
  });

  it('accepts real YYYY-MM-DD dates and rejects malformed or impossible dates', () => {
    expect(parseOptionalIsoDate('', 'Roadworthy test date')).toBeNull();
    expect(parseOptionalIsoDate('2026-09-04', 'Roadworthy test date')).toBe('2026-09-04');

    for (const value of ['04/09/2026', '2026-02-30', '2026-13-01']) {
      expect(() => parseOptionalIsoDate(value, 'Roadworthy test date')).toThrow(
        VehicleInputValidationError,
      );
    }
  });
});
