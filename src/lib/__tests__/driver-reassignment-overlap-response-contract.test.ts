import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/allocations/[id]/driver/route.ts'),
  'utf8',
);
const migrationSource = readFileSync(
  resolve(process.cwd(), 'src/db/migrations/0102_driver_handover_overlap_response.sql'),
  'utf8',
);

describe('driver reassignment overlap response contract', () => {
  it('keeps the central allocation concurrency trigger authoritative', () => {
    expect(migrationSource).toContain("ERRCODE = '23P01'");
    expect(migrationSource).toContain('allocation_driver_overlap');
    expect(routeSource).toContain('UPDATE vehicle_allocations va');
  });

  it('maps a concurrent driver-overlap rejection to the existing 409 refresh contract', () => {
    expect(routeSource).toContain("const mutationErrorCode =");
    expect(routeSource).toContain("mutationErrorCode === '23P01'");
    expect(routeSource).toContain("mutationErrorText.includes('allocation_driver_overlap')");
    expect(routeSource).toContain('The trip or driver assignment changed while reassignment was being saved. Refresh and review the current state.');
    expect(routeSource).toContain('{ status: 409 }');
  });

  it('preserves the existing atomic reassignment sentinel handling', () => {
    expect(routeSource).toContain("mutationErrorText.includes('atomic_driver_reassignment_failed')");
  });
});
