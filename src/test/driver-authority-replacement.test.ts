import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DRIVER_REACCEPTANCE_AMENDMENT_TYPES } from '@/lib/trip-amendment-acceptance';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('post-authorisation driver replacement governance', () => {
  it('treats driver replacement as a material authority amendment requiring fresh driver acceptance', () => {
    expect(DRIVER_REACCEPTANCE_AMENDMENT_TYPES).toContain('driver_replacement');
  });

  it('intercepts an authorised driver replacement before the ordinary live-allocation mutation path', () => {
    const allocationRoute = source('src/app/api/allocations/[id]/driver/route.ts');
    const governedCall = allocationRoute.indexOf('requestPostAuthorisationDriverReplacement({');
    const ordinaryMutation = allocationRoute.indexOf('.update(vehicleAllocations)');

    expect(governedCall).toBeGreaterThan(-1);
    expect(ordinaryMutation).toBeGreaterThan(-1);
    expect(governedCall).toBeLessThan(ordinaryMutation);
    expect(allocationRoute).toContain('if (governedReplacement.handled) return governedReplacement.response;');
  });

  it('requires a governed replacement instead of direct driver removal once a Trip Authority exists', () => {
    const allocationRoute = source('src/app/api/allocations/[id]/driver/route.ts');
    const deleteRoute = allocationRoute.slice(allocationRoute.indexOf('export async function DELETE'));
    const authorityGuard = deleteRoute.indexOf('if (allocation.authorityId)');
    const unassignmentMutation = deleteRoute.indexOf('SET driver_employee_id = NULL');

    expect(deleteRoute).toContain('authorityId: tripAuthorities.id');
    expect(authorityGuard).toBeGreaterThan(-1);
    expect(unassignmentMutation).toBeGreaterThan(authorityGuard);
    expect(deleteRoute).toContain('Nominate the replacement driver instead');
  });

  it('fails acknowledgement closed when the live allocation driver differs from the authority primary driver', () => {
    const acknowledgeRoute = source('src/app/api/trips/[id]/acknowledge/route.ts');

    expect(acknowledgeRoute).toContain("eq(tripAuthorisedDrivers.driverType, 'primary')");
    expect(acknowledgeRoute).toContain('trip.authorityDriverEmployeeId !== trip.driverEmployeeId');
    expect(acknowledgeRoute).toContain('does not match the current Trip Authority');
  });

  it('approves a replacement only by versioning the authority and synchronising all live driver snapshots', () => {
    const helper = source('src/lib/driver-authority-replacement.ts');

    expect(helper).toContain("eq(tripAmendments.status, 'pending')");
    expect(helper).toContain("SET driver_type = 'superseded'");
    expect(helper).toContain("'primary'");
    expect(helper).toContain('SET version = version + 1');
    expect(helper).toContain('UPDATE vehicle_allocations va');
    expect(helper).toContain('UPDATE transport_requests tr');
    expect(helper).toContain('INSERT INTO trip_authority_versions');
    expect(helper).toContain("'previousPrimaryDriverEmployeeId'");
    expect(helper).toContain("'driverReplacementAmendmentId'");
  });

  it('snapshots the real verified licence number rather than masking the licence record UUID', () => {
    const helper = source('src/lib/driver-authority-replacement.ts');

    expect(helper).toContain('licenceNumber: driverLicences.licenceNumber');
    expect(helper).toContain('maskLicenceNumber(eligible.driver.licenceNumber)');
    expect(helper).not.toContain('maskLicenceNumber(eligible.driver.licenceId)');
  });

  it('keeps the amendment decision with final-authorisation holders rather than Transport trip managers', () => {
    const decisionRoute = source('src/app/api/trips/[id]/authority/driver-replacement/route.ts');
    const permissionBlock = decisionRoute.slice(
      decisionRoute.indexOf('const AUTHORISER_PERMISSIONS'),
      decisionRoute.indexOf('type AuthoriserResult'),
    );

    expect(permissionBlock).toContain('Permissions.TRIP_AUTHORIZE_REGIONAL');
    expect(permissionBlock).toContain('Permissions.TRIP_AUTHORIZE_NATIONAL');
    expect(permissionBlock).not.toContain('Permissions.TRIP_MANAGE');
    expect(decisionRoute).toContain("requireDashboardAction(session, '/dashboard/approvals', 'approve')");
  });

  it('exposes approve and reject controls on the existing Trip Authority surface', () => {
    const authorityActions = source(
      'src/app/(dashboard)/dashboard/trips/[id]/authority/AuthorityActions.tsx',
    );

    expect(authorityActions).toContain('/authority/driver-replacement');
    expect(authorityActions).toContain("decideReplacement('approve')");
    expect(authorityActions).toContain("decideReplacement('reject')");
    expect(authorityActions).toContain('Approve revised authority');
    expect(authorityActions).toContain('The current live assignment and signed authority remain unchanged until you decide this amendment.');
  });
});
