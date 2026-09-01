import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/employees/[id]/lifecycle/route.ts'),
  'utf8',
);
const uiSource = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/dashboard/staff/[id]/EmployeeLifecycleActions.tsx'),
  'utf8',
);

describe('staff lifecycle evidence key contract', () => {
  it('rejects the dormant supportingDocumentKey field before lifecycle mutation', () => {
    expect(routeSource).toContain("Object.prototype.hasOwnProperty.call(body, 'supportingDocumentKey')");
    expect(routeSource).toContain('Supporting document uploads are not available for staff lifecycle actions.');
    expect(routeSource).toContain('{ status: 422 }');
  });

  it('does not persist a client storage key into availability history', () => {
    expect(routeSource).not.toContain('supportingDocumentKey: body.supportingDocumentKey');
  });

  it('preserves the current reason-only availability client flow', () => {
    expect(uiSource).toContain("action: 'availability'");
    expect(uiSource).toContain("reason: 'Updated from employee profile'");
    expect(uiSource).not.toContain('supportingDocumentKey');
  });

  it('keeps existing tenant and lifecycle guards intact', () => {
    expect(routeSource).toContain('eq(employees.tenantId, tenantId)');
    expect(routeSource).toContain('assertNoLiveDriverResponsibility');
    expect(routeSource).toContain('wouldDisableFinalTenantAdmin');
    expect(routeSource).toContain('restoreArchivedAccountIfAllowed');
  });
});
