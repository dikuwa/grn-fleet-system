import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const internalIssueSource = readFileSync('src/app/api/trips/[id]/issue/route.ts', 'utf8');
const externalIssueSource = readFileSync('src/app/api/trips/[id]/external-issue/route.ts', 'utf8');

function expectCanonicalIssueGate(source: string) {
  expect(source).toContain("import { evaluateTripReleaseGate } from '@/lib/trip-release-gate';");
  expect(source).toContain('const issueGate = await evaluateTripReleaseGate({');
  expect(source).toContain("stage: 'issue'");
  expect(source).toContain('blockers: issueGate.blockers');
  expect(source).toContain('checks: issueGate.checks');
  expect(source).toContain('driverKind: issueGate.driverKind');
  expect(source).toContain('actionUrl: `/dashboard/trips/${id}`');
}

describe('physical issue canonical readiness gate contract', () => {
  it('guards the internal-driver physical issue route with the canonical issue gate', () => {
    expectCanonicalIssueGate(internalIssueSource);
  });

  it('guards the external-driver physical issue route with the canonical issue gate', () => {
    expectCanonicalIssueGate(externalIssueSource);
  });

  it('keeps the external route race-safe issue claim after canonical preflight', () => {
    expect(externalIssueSource).toContain('WITH allocation_claim AS (');
    expect(externalIssueSource).toContain("AND state = 'confirmed'");
    expect(externalIssueSource).toContain('AND version = ${record.allocationVersion}');
    expect(externalIssueSource).toContain("AND eda.state = 'accepted'");
  });
});
