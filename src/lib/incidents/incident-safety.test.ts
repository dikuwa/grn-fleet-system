import { describe, expect, it } from 'vitest';
import {
  incidentRequiresVehicleRestriction,
  normalizedVehicleSafety,
} from './incident-safety';

describe('incident vehicle safety semantics', () => {
  it('does not infer vehicle condition from an unrelated journey stop decision', () => {
    expect(normalizedVehicleSafety(undefined)).toBeNull();
    expect(normalizedVehicleSafety(null)).toBeNull();
  });

  it('does not restrict a vehicle merely because a non-critical journey cannot continue', () => {
    expect(
      incidentRequiresVehicleRestriction({
        severity: 'moderate',
        vehicleDamage: false,
        vehicleSafe: null,
      }),
    ).toBe(false);
  });

  it('restricts an explicitly unsafe vehicle regardless of incident severity', () => {
    expect(
      incidentRequiresVehicleRestriction({
        severity: 'minor',
        vehicleDamage: false,
        vehicleSafe: false,
      }),
    ).toBe(true);
  });

  it('restricts a damaged vehicle even when it is not explicitly marked unsafe', () => {
    expect(
      incidentRequiresVehicleRestriction({
        severity: 'moderate',
        vehicleDamage: true,
        vehicleSafe: true,
      }),
    ).toBe(true);
  });

  it('restricts every critical incident pending technical review', () => {
    expect(
      incidentRequiresVehicleRestriction({
        severity: 'critical',
        vehicleDamage: false,
        vehicleSafe: true,
      }),
    ).toBe(true);
  });
});
