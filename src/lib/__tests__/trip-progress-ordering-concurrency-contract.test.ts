import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/[id]/operations/route.ts'),
  'utf8',
);

describe('trip progress ordering concurrency contract', () => {
  it('serializes progress writers before rechecking current journey state', () => {
    const progressBranch = routeSource.indexOf("if (action === 'progress') {");
    const advisoryLock = routeSource.indexOf(
      'SELECT pg_advisory_xact_lock(hashtextextended(${id}::text, 0))',
      progressBranch,
    );
    const lifecycleGuard = routeSource.indexOf("ELSE 'trip_progress_lifecycle_conflict'", advisoryLock);
    const odometerGuard = routeSource.indexOf("ELSE 'trip_progress_odometer_conflict'", lifecycleGuard);
    const insert = routeSource.indexOf('executor.insert(tripProgressEntries).values({', odometerGuard);
    const audit = routeSource.indexOf('executor.insert(auditEvents).values({', insert);

    expect(progressBranch).toBeGreaterThan(-1);
    expect(advisoryLock).toBeGreaterThan(progressBranch);
    expect(lifecycleGuard).toBeGreaterThan(advisoryLock);
    expect(odometerGuard).toBeGreaterThan(lifecycleGuard);
    expect(insert).toBeGreaterThan(odometerGuard);
    expect(audit).toBeGreaterThan(insert);
  });

  it('locks current trip and authority state and rechecks current driver assignment', () => {
    expect(routeSource).toContain('FOR UPDATE OF t, ta');
    expect(routeSource).toContain("t.status IN ('in_progress', 'return_due')");
    expect(routeSource).toContain("ta.status <> 'incident_reported'");
    expect(routeSource).toContain('FROM vehicle_allocations va');
    expect(routeSource).toContain('FROM request_drivers rd');
    expect(routeSource).toContain("rd.driver_type IN ('assigned', 'additional')");
  });

  it('recomputes odometer bounds and temporal neighbours after serialization', () => {
    expect(routeSource).toContain('p.occurred_at < ${occurredAtIso}::timestamptz');
    expect(routeSource).toContain('p.odometer_reading > ${odometer}::integer');
    expect(routeSource).toContain('p.occurred_at > ${occurredAtIso}::timestamptz');
    expect(routeSource).toContain('p.odometer_reading < ${odometer}::integer');
    expect(routeSource).toContain('${odometer}::integer < COALESCE(ta.beginning_odometer, 0)');
    expect(routeSource).toContain('${odometer}::integer > ta.ending_odometer');
  });

  it('uses current authority state for route-deviation transition and maps lost races to 409', () => {
    expect(routeSource).toContain('if (deviation) {');
    expect(routeSource).not.toContain("if (deviation && context.authorityStatus === 'in_progress') {");
    expect(routeSource).toContain("message.includes('trip_progress_odometer_conflict')");
    expect(routeSource).toContain('{ status: 409 }');
  });
});
