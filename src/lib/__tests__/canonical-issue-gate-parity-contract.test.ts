import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/trip-release-gate.ts', 'utf8');

function issueStageBlock() {
  const start = source.indexOf("if (input.stage === 'issue')");
  const end = source.indexOf('\n  return {', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('canonical physical-Issue gate parity', () => {
  it('requires the current trip to remain pending and physically unissued', () => {
    const block = issueStageBlock();

    expect(source).toContain('status: trips.status');
    expect(source).toContain('issuedAt: trips.issuedAt');
    expect(block).toContain("trip.status === 'pending' && !trip.issuedAt");
    expect(block).toContain("code: 'trip_not_issuable'");
    expect(block).toContain('checks.tripPendingAndUnissued');
  });

  it('requires an accepted external assignment to still match the request driver', () => {
    const block = issueStageBlock();

    expect(source).toContain(
      'requestAssignedDriverExternalPartyId: transportRequests.assignedDriverExternalPartyId',
    );
    expect(source).toContain(
      'externalPartyId: externalDriverAssignments.externalPartyId',
    );
    expect(block).toContain("externalDriver?.assignmentState === 'accepted'");
    expect(block).toContain('externalDriver.acceptedAt');
    expect(block).toContain(
      'trip.requestAssignedDriverExternalPartyId === externalDriver.externalPartyId',
    );
  });
});
