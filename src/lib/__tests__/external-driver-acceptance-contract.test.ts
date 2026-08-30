import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const decisionRoute = readFileSync(
  'src/app/api/allocations/external/[id]/decision/route.ts',
  'utf8',
);
const externalAuthorisation = readFileSync(
  'src/lib/external-authorisation-decision.ts',
  'utf8',
);

describe('external driver acceptance boundaries', () => {
  it('tenant-scopes the exact assignment, trip, request, party, and licence', () => {
    expect(decisionRoute).toContain('eq(externalDriverAssignments.id, id)');
    expect(decisionRoute).toContain('eq(externalDriverAssignments.tenantId, tenantId)');
    expect(decisionRoute).toContain('eq(trips.tenantId, tenantId)');
    expect(decisionRoute).toContain('eq(transportRequests.tenantId, tenantId)');
    expect(decisionRoute).toContain('eq(externalParties.tenantId, tenantId)');
    expect(decisionRoute).toContain('eq(externalDriverLicences.tenantId, tenantId)');
  });

  it('only accepts the still-pending, unissued assignment against the claimed allocation version', () => {
    expect(decisionRoute).toContain("record.assignment.state !== 'pending_acceptance'");
    expect(decisionRoute).toContain("record.tripStatus !== 'pending'");
    expect(decisionRoute).toContain('record.tripIssuedAt');
    expect(decisionRoute).toContain('version = ${record.allocationVersion}');
    expect(decisionRoute).toContain("eda.state = 'pending_acceptance'");
    expect(decisionRoute).toContain('eda.issue_id IS NULL');
  });

  it('revalidates active external-party and verified licence evidence through the trip period', () => {
    expect(decisionRoute).toContain("record.partyStatus !== 'active'");
    expect(decisionRoute).toContain("record.licenceStatus !== 'verified'");
    expect(decisionRoute).toContain('expiryAt < record.allocationEndAt');
    expect(decisionRoute).toContain("ep.status = 'active'");
    expect(decisionRoute).toContain("edl.verification_status = 'verified'");
    expect(decisionRoute).toContain('edl.expiry_date >= ${allocationEndDate}::date');
  });

  it('revalidates the accepted assignment and vehicle-specific licence rules at final authorisation', () => {
    expect(externalAuthorisation).toContain('eq(externalDriverAssignments.allocationId, vehicleAllocations.id)');
    expect(externalAuthorisation).toContain('eq(externalDriverAssignments.tripId, trips.id)');
    expect(externalAuthorisation).toContain('eq(externalDriverAssignments.requestId, vehicleAllocations.requestId)');
    expect(externalAuthorisation).toContain("eq(externalDriverAssignments.state, 'accepted')");
    expect(externalAuthorisation).toContain("assignment.licenceVerificationStatus !== 'verified'");
    expect(externalAuthorisation).toContain('assignment.licenceExpiry');
    expect(externalAuthorisation).toContain(
      'namibiaLicenceClassCovers(assignment.licenceClass, assignment.requiredLicenceClass)',
    );
    expect(externalAuthorisation).toContain('assignment.professionalAuthorisationRequired');
  });

  it('version-claims the same accepted assignment before final workflow completion', () => {
    expect(externalAuthorisation).toContain('va.version = ${assignment.allocationVersion}');
    expect(externalAuthorisation).toContain('eda.id = ${assignment.externalAssignmentId}::uuid');
    expect(externalAuthorisation).toContain('eda.allocation_id = va.id');
    expect(externalAuthorisation).toContain('eda.trip_id = ${assignment.tripId}::uuid');
    expect(externalAuthorisation).toContain('eda.external_party_id = ${assignment.externalPartyId}::uuid');
    expect(externalAuthorisation).toContain('eda.licence_id = ${assignment.licenceId}::uuid');
    expect(externalAuthorisation).toContain("eda.state = 'accepted'");
    expect(externalAuthorisation).toContain('eda.accepted_at IS NOT NULL');
  });
});
