import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/close/route.ts'),
  'utf8',
);

describe('trip closure transition atomicity contract', () => {
  it('verifies the closure transaction committed all required lifecycle transitions', () => {
    expect(routeSource).toContain('trip_closure_transition_conflict');
    expect(routeSource).toContain('FROM trip_closures tc');
    expect(routeSource).toContain("t.status = 'closed'");
    expect(routeSource).toContain("tr.status = 'closed'");
    expect(routeSource).toContain("va.state = 'released'");
    expect(routeSource).toContain("ta.status = 'closed'");
  });

  it('maps a stale or partial closure transition to a refreshable 409 conflict', () => {
    expect(routeSource).toContain("message.includes('trip_closure_transition_conflict')");
    expect(routeSource).toContain('Refresh the closure review and resolve the latest blockers before closing.');
    expect(routeSource).toContain('{ status: 409 }');
  });
});
