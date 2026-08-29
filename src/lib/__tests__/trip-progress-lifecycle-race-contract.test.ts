import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  join(process.cwd(), 'src/db/migrations/0098_trip_progress_active_lifecycle_guard.sql'),
  'utf8',
);
const operationsRoute = readFileSync(
  join(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);

describe('trip progress lifecycle race guard', () => {
  it('serializes new progress inserts with the authoritative trip and authority lifecycle', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION enforce_trip_progress_active_lifecycle()');
    expect(migration).toContain('FOR UPDATE OF t, ta;');
    expect(migration).toContain("v_trip_status NOT IN ('in_progress', 'return_due')");
    expect(migration).toContain("v_authority_status = 'incident_reported'");
    expect(migration).toContain('BEFORE INSERT ON trip_progress_entries');
  });

  it('uses the operations endpoint conflict path so a lost active-state race returns 409', () => {
    expect(migration).toContain("ERRCODE = '23505'");
    expect(operationsRoute).toContain("(error as { code?: string })?.code === '23505'");
    expect(operationsRoute).toContain("{ status: 409 }");
  });

  it('keeps committed offline progress recoverable before live lifecycle checks', () => {
    const replayLookup = operationsRoute.indexOf("if (clientSyncId) {");
    const liveLifecycleCheck = operationsRoute.indexOf("const activeForJourney = ['in_progress', 'return_due'].includes(context.tripStatus);");
    const progressInsert = operationsRoute.indexOf('executor.insert(tripProgressEntries).values({');

    expect(replayLookup).toBeGreaterThanOrEqual(0);
    expect(liveLifecycleCheck).toBeGreaterThan(replayLookup);
    expect(progressInsert).toBeGreaterThan(liveLifecycleCheck);
  });
});
