import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('inspection attention authority-amendment parity', () => {
  it('excludes departure work blocked by a material amendment awaiting driver re-acceptance', () => {
    const attentionRoute = source('src/app/api/inspections/attention/route.ts');
    const contextRoute = source('src/app/api/inspections/context/route.ts');
    const postRoute = source('src/app/api/inspections/route.ts');

    expect(attentionRoute).toContain('DRIVER_REACCEPTANCE_AMENDMENT_TYPES');
    expect(attentionRoute).toContain('from trip_amendments ta');
    expect(attentionRoute).toContain('ta.authority_id = ${tripAuthorities.id}');
    expect(attentionRoute).toContain("ta.status = 'approved'");
    expect(attentionRoute).toContain('coalesce(ta.approved_at, ta.created_at) > ${tripAuthorities.acceptedAt}');

    expect(contextRoute).toContain('findPendingAuthorityAmendmentAcceptance({');
    expect(postRoute).toContain('findPendingAuthorityAmendmentAcceptance({');
  });

  it('keeps return attention outside the pre-departure amendment guard', () => {
    const attentionRoute = source('src/app/api/inspections/attention/route.ts');
    const amendmentGuard = attentionRoute.indexOf('from trip_amendments ta');
    const returnBranch = attentionRoute.indexOf('inArray(trips.status, RETURN_TRIP_STATUSES)');

    expect(amendmentGuard).toBeGreaterThan(-1);
    expect(returnBranch).toBeGreaterThan(amendmentGuard);
  });
});
