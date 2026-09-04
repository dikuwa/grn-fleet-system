import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/fleet/[id]/decommission/route.ts'),
  'utf8',
);

describe('vehicle decommission status revision contract', () => {
  it('claims the exact reviewed status before decommissioning', () => {
    expect(routeSource).toContain('AND status = ${vehicle.status}');
    expect(routeSource).toContain('FOR UPDATE');
    expect(routeSource).toContain("c.status NOT IN ('issued', 'allocated')");
  });

  it('keeps same-state retries idempotent without duplicate history', () => {
    expect(routeSource).toContain('const alreadyAtTarget = vehicle.status === targetStatus;');
    expect(routeSource).toContain('AND c.status <> ${targetStatus}');
    expect(routeSource).toContain('idempotentReplay: alreadyAtTarget');
    expect(routeSource).toContain('event: alreadyAtTarget');
  });

  it('maps a lost lifecycle race to a controlled conflict', () => {
    expect(routeSource).toContain(
      'Vehicle lifecycle state changed while decommissioning was being processed.',
    );
    expect(routeSource).toContain('{ status: 409 }');
  });
});
