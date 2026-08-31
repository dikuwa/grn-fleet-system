import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const routeSource = readFileSync(
  resolve(root, 'src/app/api/requests/[id]/transport-review-correction/route.ts'),
  'utf8',
);
const allocationGuardSource = readFileSync(
  resolve(root, 'src/db/migrations/0102_driver_handover_overlap_response.sql'),
  'utf8',
);

describe('Transport Review schedule overlap response contract', () => {
  it('keeps the allocation trigger as the authoritative vehicle and driver overlap boundary', () => {
    expect(allocationGuardSource).toContain("RAISE EXCEPTION 'allocation_vehicle_overlap'");
    expect(allocationGuardSource).toContain("RAISE EXCEPTION 'allocation_driver_overlap'");
    expect(allocationGuardSource).toContain("USING ERRCODE = '23P01'");
  });

  it('maps a concurrent schedule overlap rejection to HTTP 409', () => {
    expect(routeSource).toContain('const dbErrorCode =');
    expect(routeSource).toContain("dbErrorCode === '23P01'");
    expect(routeSource).toContain("dbErrorDiagnostic.includes('allocation_vehicle_overlap')");
    expect(routeSource).toContain("dbErrorDiagnostic.includes('allocation_driver_overlap')");
    expect(routeSource).toContain('The allocation schedule changed while this correction was being saved. Refresh and review the current assignments.');
    expect(routeSource).toContain('{ status: 409 }');
  });

  it('preserves explicit TransportReviewCorrectionError handling before database fallback classification', () => {
    expect(routeSource.indexOf('error instanceof TransportReviewCorrectionError')).toBeLessThan(
      routeSource.indexOf("dbErrorCode === '23P01'"),
    );
  });
});
