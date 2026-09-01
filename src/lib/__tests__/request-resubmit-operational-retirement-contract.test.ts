import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('src/lib/request-workflow.ts', 'utf8');
const resubmit = readFileSync('src/app/api/requests/[id]/resubmit/route.ts', 'utf8');

describe('request resubmission operational retirement contract', () => {
  it('runs retirement only at the replacement-workflow boundary for returned or rejected requests', () => {
    expect(workflow).toContain("const RESUBMITTABLE_STATUSES = ['returned', 'rejected', 'supervisor_rejected']");
    expect(workflow).toContain('await retirePreOperationsStateForResubmission({');
    expect(workflow).toContain('const recoveredBeforeInit = await recoverPersistedInstance();');
    expect(workflow).toContain('await ensureDefaultWorkflowDefinition(tenantId, scope);');
    expect(resubmit).toContain('workflow_instance_id = NULL');
    expect(resubmit).toContain('workflow = await ensureRequestWorkflow(id, session.tenantId);');
  });

  it('fails closed once a trip entered operations while allowing cancelled retry evidence', () => {
    expect(workflow).toContain("t.status NOT IN ('pending', 'cancelled')");
    expect(workflow).toContain('t.issued_at IS NOT NULL');
    expect(workflow).toContain('atomic_resubmit_operational_state_failed');
  });

  it('retires all live pre-operations assignment state before a new workflow is initialized', () => {
    expect(workflow).toContain("va.state IN ('provisional', 'confirmed')");
    expect(workflow).toContain("eda.state IN ('pending_acceptance', 'accepted')");
    expect(workflow).toContain("SET status = 'cancelled', updated_at");
    expect(workflow).toContain("ta.status NOT IN ('in_progress', 'awaiting_reconciliation', 'completed', 'closed', 'cancelled')");
    expect(workflow).toContain('assigned_driver_employee_id = NULL');
    expect(workflow).toContain('assigned_driver_external_party_id = NULL');
  });

  it('records a consistent retirement reason on allocation, external assignment and authority state', () => {
    expect(workflow).toContain(
      "const cancellationReason = 'Request corrected and resubmitted; prior operational allocation retired.';",
    );
    expect(workflow).toContain('override_reason = ${cancellationReason}');
    expect(workflow).toContain('cancellation_reason = ${cancellationReason}');
  });
});
