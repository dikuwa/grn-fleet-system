import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

const queueSource = source('src/lib/approval-queue.ts');
const detailSource = source('src/lib/approval-detail.ts');
const pageSource = source('src/app/(dashboard)/dashboard/approvals/page.tsx');
const actionSource = source('src/app/api/approvals/[id]/action/route.ts');
const correctionSource = source('src/app/api/requests/[id]/transport-review-correction/route.ts');

describe('Transport Review tenant boundary contract', () => {
  it('tenant-scopes actionable approval enumeration before runtime workflow resolution', () => {
    expect(queueSource).toContain('eq(transportRequests.tenantId, input.tenantId)');
    expect(queueSource).toContain('.innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))');
  });

  it('tenant-scopes both active and historical approvals page enumeration', () => {
    expect(pageSource).toContain('eq(transportRequests.tenantId, tenantId)');
    expect(pageSource).toContain('resolveActionableApprovalInstanceIds({ db: getDb(), tenantId, userId, permissionCodes })');
    expect(pageSource).toContain('workflowActions.actorUserId} = ${userId}');
  });

  it('rejects a cross-tenant workflow id before loading approval detail children', () => {
    expect(detailSource).toContain('eq(workflowInstances.id, input.instanceId)');
    expect(detailSource).toContain('eq(transportRequests.tenantId, input.tenantId)');
    expect(detailSource.indexOf('if (!instance) return null;')).toBeGreaterThan(
      detailSource.indexOf('eq(transportRequests.tenantId, input.tenantId)'),
    );
  });

  it('denies cross-tenant approval actions before workflow execution', () => {
    expect(actionSource).toContain('requestOwner.tenantId !== session.tenantId');
    expect(actionSource).toContain("{ error: 'Workflow instance not found or access denied' }");
    expect(actionSource.indexOf('requestOwner.tenantId !== session.tenantId')).toBeLessThan(
      actionSource.indexOf('const engine = new WorkflowEngine({ db });'),
    );
  });

  it('tenant-scopes Transport Review correction lookup and allocation checks', () => {
    expect(correctionSource).toContain('eq(transportRequests.tenantId, session.tenantId)');
    expect(correctionSource).toContain('eq(vehicles.tenantId, session.tenantId)');
    expect(correctionSource).toContain('eq(externalDriverAssignments.tenantId, session.tenantId)');
    expect(correctionSource).toContain('eq(externalDriverLicences.tenantId, session.tenantId)');
  });
});
