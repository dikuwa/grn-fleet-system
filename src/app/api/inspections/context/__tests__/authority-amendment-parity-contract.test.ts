import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection context authority-amendment parity', () => {
  it('uses the canonical material-amendment acceptance guard before offering departure work', () => {
    const contextRoute = source('src/app/api/inspections/context/route.ts');
    const postRoute = source('src/app/api/inspections/route.ts');

    expect(contextRoute).toContain(
      "import { findPendingAuthorityAmendmentAcceptance } from '@/lib/trip-amendment-acceptance';",
    );
    expect(contextRoute).toContain('authorityId: tripAuthorities.id');
    expect(contextRoute).toContain('authorityAcceptedAt: tripAuthorities.acceptedAt');
    expect(contextRoute).toContain('findPendingAuthorityAmendmentAcceptance({');
    expect(contextRoute).toContain('return pendingAmendment ? null : trip;');

    expect(postRoute).toContain('findPendingAuthorityAmendmentAcceptance({');
    expect(postRoute).toContain('requiresAmendmentAcceptance: true');
  });

  it('keeps return inspection discovery outside the pre-departure re-acceptance rule', () => {
    const contextRoute = source('src/app/api/inspections/context/route.ts');

    expect(contextRoute).toContain("const lifecycleEligibleTrips = type === 'departure'");
    expect(contextRoute).toContain(': driverEligibleTrips;');
  });
});
