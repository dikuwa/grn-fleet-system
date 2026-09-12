import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/route.ts'),
  'utf8',
);

describe('inspection confirmed allocation guard', () => {
  it('requires the submitted trip and vehicle to resolve through the authoritative allocation', () => {
    expect(source).toContain('tripAuthorities, trips, vehicleAllocations, vehicleInspections');
    expect(source).toContain('eq(vehicleAllocations.id, trips.allocationId)');
    expect(source).toContain('eq(vehicleAllocations.requestId, trips.requestId)');
    expect(source).toContain('eq(vehicleAllocations.vehicleId, trips.vehicleId)');
    expect(source).toContain('eq(trips.id, tripId)');
    expect(source).toContain('eq(trips.vehicleId, vehicleId)');
    expect(source).toContain('eq(trips.tenantId, session.tenantId)');
  });

  it('checks an existing sync token before applying current allocation state to a new submission', () => {
    const replayLookupIndex = source.indexOf('eq(vehicleInspections.clientSyncId, clientSyncId)');
    const allocationGuardIndex = source.indexOf('if (!hasExistingSyncInspection && tripId && vehicleId)');
    const allocationStateIndex = source.indexOf("if (allocation.state !== 'confirmed')");

    expect(replayLookupIndex).toBeGreaterThan(-1);
    expect(allocationGuardIndex).toBeGreaterThan(replayLookupIndex);
    expect(allocationStateIndex).toBeGreaterThan(allocationGuardIndex);
    expect(source).toContain('hasExistingSyncInspection = Boolean(existingSyncInspection)');
  });

  it('rejects a non-confirmed allocation before service execution for a genuinely new inspection', () => {
    const allocationStateIndex = source.indexOf("if (allocation.state !== 'confirmed')");
    const conflictIndex = source.indexOf(
      'Inspection requires the trip current vehicle allocation to be confirmed.',
    );
    const serviceIndex = source.indexOf('const result = await completeOfficialInspection({');

    expect(allocationStateIndex).toBeGreaterThan(-1);
    expect(conflictIndex).toBeGreaterThan(allocationStateIndex);
    expect(source).toContain('{ status: 409 }');
    expect(serviceIndex).toBeGreaterThan(conflictIndex);
  });

  it('lets service ownership and payload-binding checks handle existing sync-token replays', () => {
    expect(source).toContain("if (!hasExistingSyncInspection && body.type === 'departure' && tripId)");
    expect(source).toContain('clientSyncId,');
  });
});
