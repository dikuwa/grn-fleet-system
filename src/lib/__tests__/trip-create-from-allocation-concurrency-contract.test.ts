import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const routeSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/trips/create-from-allocation/route.ts'),
  'utf8',
);

describe('trip creation allocation concurrency recovery', () => {
  it('locks and revalidates the parent allocation before any trip-creation mutation', () => {
    const batchStart = routeSource.indexOf('await runAtomicMutations((tx) => [');
    const guardStart = routeSource.indexOf('tx.execute(sql`', batchStart);
    const requestUpdate = routeSource.indexOf('tx.update(transportRequests)', batchStart);
    const tripInsert = routeSource.indexOf('tx.insert(trips)', batchStart);

    expect(batchStart).toBeGreaterThan(-1);
    expect(guardStart).toBeGreaterThan(batchStart);
    expect(requestUpdate).toBeGreaterThan(guardStart);
    expect(tripInsert).toBeGreaterThan(requestUpdate);

    const guardSource = routeSource.slice(guardStart, requestUpdate);
    expect(guardSource).toContain('FOR UPDATE OF va, tr');
    expect(guardSource).toContain('AND va.version = ${allocation.version}');
    expect(guardSource).toContain("AND va.state = 'confirmed'");
    expect(guardSource).toContain('AND va.request_id = ${allocation.requestId}::uuid');
    expect(guardSource).toContain('AND va.vehicle_id = ${allocation.vehicleId}::uuid');
    expect(guardSource).toContain("'vehicle_allocated'");
    expect(guardSource).toContain('TRIP_CREATION_ALLOCATION_CONFLICT');
  });

  it('records the allocation revision used to create the trip', () => {
    expect(routeSource).toContain('allocationVersion: allocation.version');
  });

  it('maps a lost parent-state race to a controlled 409 and preserves replay recovery', () => {
    const conflictStart = routeSource.indexOf('if (details.message.includes(TRIP_CREATION_ALLOCATION_CONFLICT))');
    const uniqueStart = routeSource.indexOf("if (details.code === '23505')", conflictStart);
    const conflictSource = routeSource.slice(conflictStart, uniqueStart);

    expect(conflictStart).toBeGreaterThan(-1);
    expect(conflictSource).toContain('const replay = await replayExistingTrip();');
    expect(conflictSource).toContain('if (replay) return replay;');
    expect(conflictSource).toContain('{ status: 409 }');
    expect(conflictSource).toContain('Refresh the allocation and review its current state.');
  });
});
