import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);

describe('trip operation lifecycle race contract', () => {
  it('rechecks journey progress eligibility inside the atomic batch', () => {
    expect(routeSource).toContain('trip_progress_lifecycle_conflict');
    expect(routeSource).toContain("status IN ('in_progress', 'return_due')");
  });

  it('rechecks expense eligibility inside the atomic batch', () => {
    expect(routeSource).toContain('trip_expense_lifecycle_conflict');
    expect(routeSource).toContain("status IN ('in_progress', 'return_due', 'closure_review')");
  });

  it('maps lifecycle races to a refreshable 409 response', () => {
    expect(routeSource).toContain("message.includes('trip_progress_lifecycle_conflict')");
    expect(routeSource).toContain("message.includes('trip_expense_lifecycle_conflict')");
    expect(routeSource).toContain('{ status: 409 }');
  });
});
