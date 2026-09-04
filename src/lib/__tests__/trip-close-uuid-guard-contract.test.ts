import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const closeRoute = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/close/route.ts'),
  'utf8',
);

describe('trip close UUID guard contract', () => {
  it('preserves request and authorization validation before rejecting malformed ids ahead of database access', () => {
    const decisionIndex = closeRoute.indexOf('if (!CLOSURE_DECISIONS.includes(decision))');
    const reviewNotesIndex = closeRoute.indexOf('if (reviewNotes.length > 2000)');
    const permissionIndex = closeRoute.indexOf('const permCheck = await requirePermission');
    const guardIndex = closeRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const dbIndex = closeRoute.indexOf('const db = getDb()');

    expect(closeRoute).toContain('const UUID_PATTERN =');
    expect(closeRoute).toContain("{ error: 'Trip ID is invalid' }");
    expect(closeRoute).toContain('{ status: 400 }');
    expect(decisionIndex).toBeGreaterThan(-1);
    expect(reviewNotesIndex).toBeGreaterThan(decisionIndex);
    expect(permissionIndex).toBeGreaterThan(reviewNotesIndex);
    expect(guardIndex).toBeGreaterThan(permissionIndex);
    expect(dbIndex).toBeGreaterThan(guardIndex);
  });

  it('keeps UUID-backed closure claims and existing concurrency conflicts behind the guard', () => {
    const guardIndex = closeRoute.indexOf('if (!UUID_PATTERN.test(id))');
    const firstTripCastIndex = closeRoute.indexOf('${id}::uuid');

    expect(firstTripCastIndex).toBeGreaterThan(guardIndex);
    expect(closeRoute).toContain("message.includes('closure_decision_conflict')");
    expect(closeRoute).toContain("message.includes('trip_closure_lifecycle_conflict')");
    expect(closeRoute).toContain("message.includes('trip_closure_transition_conflict')");

    const conflictHandlingIndex = closeRoute.indexOf("message.includes('closure_decision_conflict')");
    const genericFailureIndex = closeRoute.indexOf("{ error: 'Failed to close trip' }");
    expect(conflictHandlingIndex).toBeGreaterThan(guardIndex);
    expect(genericFailureIndex).toBeGreaterThan(conflictHandlingIndex);
  });
});