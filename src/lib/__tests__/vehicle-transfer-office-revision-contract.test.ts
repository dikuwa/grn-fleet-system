import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/transfer/route.ts'),
  'utf8',
);

describe('vehicle transfer office revision contract', () => {
  it('claims the exact reviewed office and status before transferring', () => {
    expect(routeSource).toContain('AND status = ${vehicle.status}');
    expect(routeSource).toContain('office_id IS NOT DISTINCT FROM ${vehicle.officeId}::uuid');
    expect(routeSource).toContain(
      'assigned_office_id IS NOT DISTINCT FROM ${vehicle.assignedOfficeId}::uuid',
    );
    expect(routeSource).toContain('FOR UPDATE');
  });

  it('does not append duplicate history for a same-target retry', () => {
    expect(routeSource).toContain('const alreadyAtTarget =');
    expect(routeSource).toContain('c.office_id IS DISTINCT FROM ${targetOfficeId}::uuid');
    expect(routeSource).toContain('c.assigned_office_id IS DISTINCT FROM ${targetOfficeId}::uuid');
    expect(routeSource).toContain('idempotentReplay: alreadyAtTarget');
  });

  it('returns a controlled conflict when a newer office assignment wins the race', () => {
    expect(routeSource).toContain(
      'Vehicle office assignment or operational state changed while the transfer was being processed.',
    );
    expect(routeSource).toContain('{ status: 409 }');
  });
});
