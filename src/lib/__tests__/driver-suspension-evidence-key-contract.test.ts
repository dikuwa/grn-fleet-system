import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/drivers/[id]/status/route.ts'),
  'utf8',
);
const uiSource = readFileSync(
  resolve(process.cwd(), 'src/app/(dashboard)/dashboard/drivers/[id]/DriverStatusActions.tsx'),
  'utf8',
);

describe('driver suspension evidence key contract', () => {
  it('rejects the dormant raw documentKey field before lifecycle mutation', () => {
    expect(routeSource).toContain("Object.prototype.hasOwnProperty.call(body, 'documentKey')");
    expect(routeSource).toContain('Suspension document uploads are not supported by this action.');
    expect(routeSource).toContain('{ status: 422 }');
  });

  it('does not promote a client storage key into an employee suspension document', () => {
    expect(routeSource).not.toContain('document_insert AS (');
    expect(routeSource).not.toContain("'suspension_order'");
    expect(routeSource).not.toContain('${documentKey || null}');
  });

  it('preserves the current reason-only suspension client flow', () => {
    expect(uiSource).toContain("action: 'suspend'");
    expect(uiSource).toContain('reason: suspendReason.trim()');
    expect(uiSource).not.toContain('documentKey');
  });

  it('keeps suspend/reactivate atomic conflict handling intact', () => {
    expect(routeSource).toContain('WITH profile_claim AS (');
    expect(routeSource).toContain("atomic_driver_status_failed_");
    expect(routeSource).toContain("String(error).includes('atomic_driver_status_failed')");
    expect(routeSource).toContain('{ status: 409 }');
  });
});
