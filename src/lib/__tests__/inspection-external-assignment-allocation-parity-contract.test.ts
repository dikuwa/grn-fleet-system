import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const contextSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/context/route.ts'),
  'utf8',
);
const submissionSource = readFileSync(
  resolve(process.cwd(), 'src/app/api/inspections/route.ts'),
  'utf8',
);

describe('inspection external-driver allocation parity', () => {
  it('binds form-context external drivers to the trip current allocation', () => {
    expect(contextSource).toContain('allocationId: trips.allocationId');
    expect(contextSource).toContain('allocationId: externalDriverAssignments.allocationId');
    expect(contextSource).toContain('function externalAssignmentKey(tripId: string, allocationId: string)');
    expect(contextSource).toContain('externalAssignmentKey(trip.id, trip.allocationId)');
    expect(contextSource).not.toContain('const acceptedExternalByTrip = new Map(');
  });

  it('requires a current-allocation accepted external driver before new inspection execution', () => {
    const allocationGuardIndex = submissionSource.indexOf("if (!hasExistingSyncInspection && tripId && vehicleId)");
    const allocationBindingIndex = submissionSource.indexOf(
      'eq(externalDriverAssignments.allocationId, allocation.id)',
    );
    const serviceIndex = submissionSource.indexOf('const result = await completeOfficialInspection({');

    expect(allocationGuardIndex).toBeGreaterThan(-1);
    expect(allocationBindingIndex).toBeGreaterThan(allocationGuardIndex);
    expect(serviceIndex).toBeGreaterThan(allocationBindingIndex);
    expect(submissionSource).toContain("eq(externalDriverAssignments.state, 'accepted')");
  });

  it('keeps external-driver return inspection bound to physical issue evidence', () => {
    expect(submissionSource).toContain("if (body.type === 'return' && !externalDriver.issueId)");
    expect(submissionSource).toContain(
      'External-driver return inspection requires a completed physical vehicle issue record',
    );
  });
});
