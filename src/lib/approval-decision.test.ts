import { describe, expect, it } from 'vitest';
import {
  buildApprovalAlerts,
  buildApprovalRequestTitle,
  buildStructuredDecisionBrief,
  getApprovalPrimaryAction,
  isApprovalCommentRequired,
} from '@/lib/approval-decision';

describe('approval decision title', () => {
  it('uses the primary route and structured purpose', () => {
    expect(
      buildApprovalRequestTitle({
        purpose: 'Regional Planning Workshop',
        routes: [{ originName: 'Rundu', destinationName: 'Windhoek' }],
      }),
    ).toBe('Rundu to Windhoek — Regional Planning Workshop');
  });

  it('falls back without inventing missing data', () => {
    expect(buildApprovalRequestTitle({ purpose: 'Roads Review' })).toBe('Roads Review');
    expect(buildApprovalRequestTitle({ routes: [{ destinationName: 'Katima Mulilo' }] })).toBe(
      'Katima Mulilo',
    );
    expect(buildApprovalRequestTitle({})).toBe('Transport Request');
  });
});

describe('structured approval brief', () => {
  it('states known facts and explicit fallbacks', () => {
    const brief = buildStructuredDecisionBrief({
      travellerCount: 3,
      origin: 'Rundu',
      destination: 'Windhoek',
      purpose: 'Workshop',
      vehicleType: null,
      driverAssigned: false,
      specialAuthorityRequired: true,
      currentStage: 'Supervisor Approval',
    });
    expect(brief).toContain('3 travellers');
    expect(brief).toContain('Requested vehicle: Not provided');
    expect(brief).toContain('Driver: Not yet assigned');
    expect(brief).toContain('Special authority: Required');
    expect(brief).toContain('Current decision: Supervisor Approval');
  });
});

describe('approval checks and decisions', () => {
  it('creates only applicable decision alerts', () => {
    const alerts = buildApprovalAlerts(
      {
        scope: 'national',
        specialAuthorityRequired: false,
        attachmentCount: 1,
        travellerCount: 7,
        requesterIsPassenger: false,
        routes: [{ mappedDistanceKm: 500, overrideReason: 'Approved detour' }],
        departureAt: '2026-08-03T12:00:00.000Z',
        driverAssigned: true,
        hasDriverWithUnvalidatedLicence: false,
        vehicleAssigned: true,
        vehicleCapacity: 5,
        revision: 1,
        hasActingApproval: false,
      },
      new Date('2026-08-02T12:00:00.000Z'),
    );
    expect(alerts.map((alert) => alert.id)).toEqual([
      'national-scope',
      'distance-overridden',
      'departure-near',
      'capacity-risk',
    ]);
  });

  it('requires reasons for negative decisions and respects step policy', () => {
    expect(isApprovalCommentRequired('rejected', false)).toBe(true);
    expect(isApprovalCommentRequired('returned', false)).toBe(true);
    expect(isApprovalCommentRequired('approved', true)).toBe(true);
    expect(isApprovalCommentRequired('approved', false)).toBe(false);
    expect(getApprovalPrimaryAction('authorise').label).toBe('Authorise');
    expect(getApprovalPrimaryAction('release').label).toBe('Release');
  });
});
