import { describe, expect, it } from 'vitest';
import {
  assertTripAuthorityProvisioningInvariants,
  assertAuthorityTransition,
  canTransitionAuthority,
  classifyAuthorityInsertConflict,
  manualAuthorityNumberInUseError,
  maskLicenceNumber,
  MAX_MANUAL_AUTHORITY_NUMBER_LENGTH,
  ManualAuthorityNumberError,
  normaliseManualAuthorityNumber,
  validateManualAuthorityNumber,
} from '@/lib/trip-authority';

const validProvisioningContext = {
  tenantId: 'tenant-1',
  requestId: 'request-1',
  allocationId: 'allocation-1',
  tripId: 'trip-1',
  actorUserId: 'authoriser-1',
  trip: {
    id: 'trip-1',
    tenantId: 'tenant-1',
    requestId: 'request-1',
    allocationId: 'allocation-1',
    vehicleId: 'vehicle-1',
  },
  allocation: {
    id: 'allocation-1',
    requestId: 'request-1',
    vehicleId: 'vehicle-1',
    driverEmployeeId: 'driver-1',
    state: 'confirmed',
    endAt: new Date('2027-01-10T12:00:00Z'),
  },
  currentAllocationId: 'allocation-1',
  vehicle: { id: 'vehicle-1', tenantId: 'tenant-1', seatedCapacity: 5 },
  driver: {
    employeeId: 'driver-1',
    tenantId: 'tenant-1',
    licenceExpiry: '2027-01-10',
    verificationStatus: 'verified',
  },
  recordedAuthoriserUserId: 'authoriser-1',
  passengerCount: 4,
};

describe('Trip Authority lifecycle', () => {
  it('enforces the normal driver lifecycle', () => {
    expect(canTransitionAuthority('awaiting_driver_acceptance', 'driver_accepted')).toBe(true);
    expect(canTransitionAuthority('driver_accepted', 'awaiting_pre_trip_inspection')).toBe(true);
    expect(canTransitionAuthority('awaiting_pre_trip_inspection', 'ready_for_departure')).toBe(
      true,
    );
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
    expect(() => assertAuthorityTransition('ready_for_departure', 'closed')).toThrow(/cannot move/);
  });

  it('masks licence numbers for official presentation', () => {
    expect(maskLicenceNumber('N12345678')).toBe('*****5678');
    expect(maskLicenceNumber('1234')).toBe('****');
  });

  it('normalises manual authority numbers before selection', () => {
    expect(normaliseManualAuthorityNumber('  TA-2026-PB-0042  ')).toBe('TA-2026-PB-0042');
    expect(normaliseManualAuthorityNumber('PB 42  /  2026')).toBe('PB 42 / 2026');
    expect(normaliseManualAuthorityNumber('   ')).toBe('');
    expect(normaliseManualAuthorityNumber(undefined)).toBe('');
    expect(normaliseManualAuthorityNumber(null)).toBe('');
  });

  it('accepts valid manual physical authority numbers of any shape', () => {
    expect(validateManualAuthorityNumber('TA-2026-PB-0042')).toBe('TA-2026-PB-0042');
    expect(validateManualAuthorityNumber('PB 42/2026')).toBe('PB 42/2026');
  });

  it('rejects empty manual numbers with a clear validation error', () => {
    expect(() => validateManualAuthorityNumber('')).toThrow(ManualAuthorityNumberError);
    expect(() => validateManualAuthorityNumber('')).toThrow(/leave the field blank/i);
  });

  it('rejects manual numbers that exceed the sensible length limit', () => {
    expect(() =>
      validateManualAuthorityNumber('X'.repeat(MAX_MANUAL_AUTHORITY_NUMBER_LENGTH + 1)),
    ).toThrow(ManualAuthorityNumberError);
  });

  it('rejects manual numbers containing control characters', () => {
    expect(() => validateManualAuthorityNumber('PB\u0000-42')).toThrow(ManualAuthorityNumberError);
  });

  it('accepts one exact current assignment with a valid driver, capacity, and recorded authoriser', () => {
    expect(() => assertTripAuthorityProvisioningInvariants(validProvisioningContext)).not.toThrow();
  });

  it.each([
    ['cross-tenant trip', { trip: { ...validProvisioningContext.trip, tenantId: 'tenant-2' } }],
    [
      'mismatched allocation',
      { trip: { ...validProvisioningContext.trip, allocationId: 'old-allocation' } },
    ],
    [
      'cancelled allocation',
      { allocation: { ...validProvisioningContext.allocation, state: 'cancelled' } },
    ],
    ['superseded allocation', { currentAllocationId: 'allocation-2' }],
    [
      'wrong tenant driver',
      { driver: { ...validProvisioningContext.driver, tenantId: 'tenant-2' } },
    ],
    [
      'expired licence',
      { driver: { ...validProvisioningContext.driver, licenceExpiry: '2027-01-09' } },
    ],
    ['capacity overflow', { passengerCount: 5 }],
    ['wrong authoriser', { recordedAuthoriserUserId: 'authoriser-2' }],
  ])('rejects %s', (_label, patch) => {
    expect(() =>
      assertTripAuthorityProvisioningInvariants({
        ...validProvisioningContext,
        ...patch,
      }),
    ).toThrow();
  });
});

describe('authority insert conflict classification (concurrent unique violations)', () => {
  const uniqueViolation = { code: '23505' } as unknown;

  it('rethrows non-unique-constraint failures untouched', () => {
    expect(
      classifyAuthorityInsertConflict({
        error: new Error('connection reset'),
        manualAuthorityNumber: 'PB-42',
        racedAuthorityFound: true,
        racedDriverMatches: true,
        racedVersionExists: true,
      }),
    ).toEqual({ kind: 'rethrow' });
  });

  it('treats a fully matching raced authority as an idempotent retry', () => {
    expect(
      classifyAuthorityInsertConflict({
        error: uniqueViolation,
        manualAuthorityNumber: undefined,
        racedAuthorityFound: true,
        racedDriverMatches: true,
        racedVersionExists: true,
      }),
    ).toEqual({ kind: 'idempotent' });
  });

  it('maps a manual number collision on another trip to a manual-number conflict', () => {
    // TOCTOU race: the pre-check passed, then the tenant+number unique index
    // rejected the insert for a *different* trip with the same manual number.
    expect(
      classifyAuthorityInsertConflict({
        error: uniqueViolation,
        manualAuthorityNumber: 'PB-42',
        racedAuthorityFound: false,
        racedDriverMatches: false,
        racedVersionExists: false,
      }),
    ).toEqual({ kind: 'manual-number-conflict' });
  });

  it('maps a mismatched raced authority with a manual number to a manual-number conflict', () => {
    expect(
      classifyAuthorityInsertConflict({
        error: uniqueViolation,
        manualAuthorityNumber: 'PB-42',
        racedAuthorityFound: true,
        racedDriverMatches: false,
        racedVersionExists: false,
      }),
    ).toEqual({ kind: 'manual-number-conflict' });
  });

  it('rethrows an unmatched raced authority when no manual number was supplied', () => {
    expect(
      classifyAuthorityInsertConflict({
        error: uniqueViolation,
        manualAuthorityNumber: undefined,
        racedAuthorityFound: true,
        racedDriverMatches: false,
        racedVersionExists: false,
      }),
    ).toEqual({ kind: 'rethrow' });
  });

  it('treats whitespace-only manual input as absent (automatic path rethrows)', () => {
    expect(
      classifyAuthorityInsertConflict({
        error: uniqueViolation,
        manualAuthorityNumber: '   ',
        racedAuthorityFound: false,
        racedDriverMatches: false,
        racedVersionExists: false,
      }),
    ).toEqual({ kind: 'rethrow' });
  });

  it('produces the canonical in-use error message', () => {
    const error = manualAuthorityNumberInUseError();
    expect(error).toBeInstanceOf(ManualAuthorityNumberError);
    expect(error.code).toBe('MANUAL_AUTHORITY_NUMBER_INVALID');
    expect(error.message).toBe(
      'This Trip Authority number is already in use. Check the physical document number and try again.',
    );
  });
});
