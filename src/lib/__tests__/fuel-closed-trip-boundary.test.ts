import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(resolve(process.cwd(), 'src/app/api/fuel/route.ts'), 'utf8');

describe('trip-linked fuel lifecycle boundary', () => {
  it('rejects manager fuel entries once the trip is closed', () => {
    expect(routeSource).toContain('status: trips.status');
    expect(routeSource).toContain("if (tenantTrip.status === 'closed')");
    expect(routeSource).toContain('This trip is already closed. Fuel records linked to a closed trip are immutable.');
    expect(routeSource).toContain('{ status: 409 }');
  });

  it('keeps driver fuel entry limited to active trip states', () => {
    expect(routeSource).toContain("sql`${trips.status} in ('in_progress', 'return_due')`");
  });
});
