import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('Transport Review request corrections', () => {
  it('requires the active Transport Review reviewer rather than permission alone', () => {
    const route = read(
      'src/app/api/transport-requests/[id]/transport-review-correction/route.ts',
    );

    expect(route).toContain('Permissions.REQUEST_REVIEW_TRANSPORT');
    expect(route).toContain("approval.currentStep?.actionType !== 'transport_review'");
    expect(route).toContain('!approval?.canAct');
  });

  it('does not allow schedule changes to silently invalidate a live allocation', () => {
    const route = read(
      'src/app/api/transport-requests/[id]/transport-review-correction/route.ts',
    );

    expect(route).toContain('scheduleChanged && context.liveAllocation');
    expect(route).toContain('Cancel that allocation first');
    expect(route).toContain('programme.endDate');
  });

  it('keeps the active workflow intact and uses an atomic optimistic claim', () => {
    const route = read(
      'src/app/api/transport-requests/[id]/transport-review-correction/route.ts',
    );

    expect(route).toContain("AND status = 'transport_review'");
    expect(route).toContain('AND workflow_instance_id = ${workflowInstanceId}::uuid');
    expect(route).toContain('SELECT 1 / (SELECT count(*)::integer FROM request_claim) AS committed');
    expect(route).not.toContain('workflow_instance_id = NULL');
    expect(route).not.toContain('ensureRequestWorkflow');
  });

  it('uses the themed date picker and sends reviewers to allocation management before date changes', () => {
    const panel = read(
      'src/components/approvals/transport-review-request-corrections.tsx',
    );

    expect(panel).toContain('<DatePicker');
    expect(panel).toContain('Manage allocation');
    expect(panel).not.toContain('window.alert');
    expect(panel).not.toContain('window.confirm');
  });
});
