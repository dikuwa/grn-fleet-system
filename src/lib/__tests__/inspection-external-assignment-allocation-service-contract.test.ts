import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/lib/inspection-service.ts'),
  'utf8',
);

describe('inspection service external-driver allocation binding', () => {
  it('selects the trip current allocation for external-driver authorization', () => {
    expect(source).toContain('allocationId: trips.allocationId');
  });

  it('requires the accepted external-driver assignment to belong to that allocation', () => {
    expect(source).toContain('eq(externalDriverAssignments.tenantId, tenantId)');
    expect(source).toContain('eq(externalDriverAssignments.tripId, input.tripId)');
    expect(source).toContain(
      'eq(externalDriverAssignments.allocationId, trip.allocationId)',
    );
    expect(source).toContain("eq(externalDriverAssignments.state, 'accepted')");
  });
});
