import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/approvals/[id]/action/route.ts'),
  'utf8',
);

describe('approval workflow instance UUID guard', () => {
  it('keeps authorization and decision validation before the UUID guard and DB access', () => {
    const authIndex = source.indexOf('const auth = await requireRequestAuth(request)');
    const approvalsActionIndex = source.indexOf(
      "requireDashboardAction(session, '/dashboard/approvals', 'approve')",
    );
    const driverFallbackIndex = source.indexOf(
      "requireDashboardAction(\n        session,\n        '/dashboard/driver-mobile',\n        'update'",
    );
    const decisionIndex = source.indexOf('if (!validDecisions.includes(actionType))');
    const reasonIndex = source.indexOf(
      "if ((!comment || !String(comment).trim()) && ['returned', 'rejected'].includes(actionType))",
    );
    const guardIndex = source.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = source.indexOf('const db = getDb()');

    expect(source).toContain('const UUID_PATTERN =');
    expect(approvalsActionIndex).toBeGreaterThan(authIndex);
    expect(driverFallbackIndex).toBeGreaterThan(approvalsActionIndex);
    expect(decisionIndex).toBeGreaterThan(approvalsActionIndex);
    expect(reasonIndex).toBeGreaterThan(decisionIndex);
    expect(guardIndex).toBeGreaterThan(reasonIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
    expect(source).toContain("{ error: 'Workflow instance not found' }, { status: 404 }");
  });

  it('preserves release gates, finance evidence and atomic decision routing', () => {
    expect(source).toContain("stepActionType === 'finance_review'");
    expect(source).toContain('Approved amount must be a valid NAD amount.');
    expect(source).toContain("stepActionType === 'transport_review'");
    expect(source).toContain("stage: 'release'");
    expect(source).toContain("stepActionType === 'authorise'");
    expect(source).toContain("stage: 'authorisation'");
    expect(source).toContain('processSupervisorDecisionAtomic({');
    expect(source).toContain('processAtomicWorkflowDecision({');
    expect(source).toContain('processExternalAuthorisationDecision({');
    expect(source).toContain('processAuthorisationDecision({');
  });

  it('preserves expected atomic rollback normalization as a 409', () => {
    expect(source).toContain("candidate?.code === '22P02'");
    expect(source).toContain("String(candidate.message || '').includes('atomic_')");
    expect(source).toContain('if (isExpectedAtomicRollback(error))');
    expect(source).toContain('This workflow changed while the decision was being recorded. Refresh and try again.');
    expect(source).toContain('{ status: 409 }');
  });
});
