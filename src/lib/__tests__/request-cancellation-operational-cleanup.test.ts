import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/requests/[id]/cancel/route.ts'),
  'utf8',
);

describe('request cancellation operational cleanup', () => {
  it('retires internal and external driver pointers with the request claim', () => {
    expect(routeSource).toContain('assigned_driver_employee_id = NULL');
    expect(routeSource).toContain('assigned_driver_external_party_id = NULL');
    expect(routeSource).toContain('external_assignment_cancel AS (');
    expect(routeSource).toContain("eda.state IN ('pending_acceptance', 'accepted')");
    expect(routeSource).toContain('external_request_driver_reset AS (');
    expect(routeSource).toContain("driver_type = 'nominated'");
  });

  it('retires an external nomination even when no assignment record was created yet', () => {
    const resetStart = routeSource.indexOf('external_request_driver_reset AS (');
    const resetEnd = routeSource.indexOf('trip_cancel AS (');
    const resetSql = routeSource.slice(resetStart, resetEnd);
    expect(resetSql).toContain('EXISTS (SELECT 1 FROM request_claim)');
    expect(resetSql).not.toContain('EXISTS (SELECT 1 FROM external_assignment_cancel)');
  });

  it('retires governed Trip Authority documents tied to cancelled allocations', () => {
    expect(routeSource).toContain('generated_authority_cancel AS (');
    expect(routeSource).toContain("gd.entity_type = 'vehicle_allocation'");
    expect(routeSource).toContain("gd.document_type = 'trip_authority'");
    expect(routeSource).toContain("gd.status IN ('draft', 'issued')");
    expect(routeSource).toContain("SET status = 'cancelled'");
    expect(routeSource).toContain('reason = ${reason}');
  });

  it('keeps wrapped cancellation conflicts on the controlled 409 path', () => {
    const nested = new Error('outer wrapper', {
      cause: new Error('drizzle wrapper', {
        cause: new Error('division by zero while atomic_request_cancel_failed'),
      }),
    });
    expect(getDatabaseErrorDetails(nested).message).toContain('atomic_request_cancel_failed');
    expect(routeSource).toContain("import { getDatabaseErrorDetails } from '@/lib/database-error-details';");
    expect(routeSource).toContain('const { message } = getDatabaseErrorDetails(error);');
    expect(routeSource).not.toContain("String(error).includes('atomic_request_cancel_failed')");
    expect(routeSource).toContain("status: 409");
  });
});
