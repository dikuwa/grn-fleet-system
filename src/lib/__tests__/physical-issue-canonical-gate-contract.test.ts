import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const internalIssueSource = readFileSync('src/app/api/trips/[id]/issue/route.ts', 'utf8');
const externalIssueSource = readFileSync('src/app/api/trips/[id]/external-issue/route.ts', 'utf8');
const externalIssueCoreSource = readFileSync('src/app/api/trips/[id]/external-issue/core.ts', 'utf8');

function expectCanonicalIssueGate(source: string) {
  expect(source).toContain("import { evaluateTripReleaseGate } from '@/lib/trip-release-gate';");
  expect(source).toContain('const issueGate = await evaluateTripReleaseGate({');
  expect(source).toContain("stage: 'issue'");
  expect(source).toContain('const exactTripReady = issueGate.tripId === id;');
  expect(source).toContain('blockers: issueGate.blockers');
  expect(source).toContain('checks: issueGate.checks');
  expect(source).toContain('driverKind: issueGate.driverKind');
  expect(source).toContain('actionUrl: `/dashboard/trips/${id}`');

  const permissionIndex = source.indexOf('await requirePermission(');
  const gateIndex = source.indexOf('await evaluateTripReleaseGate({');
  expect(permissionIndex).toBeGreaterThan(-1);
  expect(gateIndex).toBeGreaterThan(permissionIndex);
  expect(source).not.toContain('request.json(');
}

describe('physical issue canonical readiness gate contract', () => {
  it('guards the internal-driver physical issue route with the canonical issue gate', () => {
    expectCanonicalIssueGate(internalIssueSource);
  });

  it('guards the external-driver physical issue route with the canonical issue gate', () => {
    expectCanonicalIssueGate(externalIssueSource);
  });

  it('keeps the external route race-safe issue claim after canonical preflight', () => {
    expect(externalIssueCoreSource).toContain('WITH allocation_claim AS (');
    expect(externalIssueCoreSource).toContain("AND state = 'confirmed'");
    expect(externalIssueCoreSource).toContain('AND version = ${record.allocationVersion}');
    expect(externalIssueCoreSource).toContain("AND eda.state = 'accepted'");
  });
});
