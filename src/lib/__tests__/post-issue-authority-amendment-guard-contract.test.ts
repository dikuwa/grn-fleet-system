import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'src/db/migrations/0103_post_issue_authority_amendment_guard.sql',
  'utf8',
);
const amendmentRoute = readFileSync(
  'src/app/api/trips/[id]/authority/amendments/route.ts',
  'utf8',
);
const acceptanceHelper = readFileSync('src/lib/trip-amendment-acceptance.ts', 'utf8');
const authorityPdf = readFileSync('src/app/api/trips/[id]/authority/pdf/route.ts', 'utf8');
const publicVerification = readFileSync('src/app/verify/authority/[token]/page.tsx', 'utf8');

describe('post-issue material Trip Authority amendment guard', () => {
  it('keeps generic material amendments on the pre-departure lifecycle only', () => {
    expect(migration).toContain("'date_extension'");
    expect(migration).toContain("'route_change'");
    expect(migration).toContain("'purpose_clarification'");
    expect(migration).toContain("'special_authorisation'");
    expect(migration).not.toContain("'vehicle_replacement'");
    expect(migration).not.toContain("'driver_replacement'");
    expect(migration).toContain("v_trip_issued_at IS NOT NULL OR v_trip_status <> 'pending'");
    expect(migration).toContain('material Trip Authority amendments cannot be approved after physical issue or departure');
  });

  it('serializes amendment approval with trip and authority lifecycle writers', () => {
    expect(migration).toContain('FROM trips');
    expect(migration).toContain('FROM trip_authorities');
    expect(migration.match(/FOR UPDATE;/g)?.length).toBeGreaterThanOrEqual(2);
    expect(migration).toContain('authority_amendment_lifecycle_conflict');
    expect(migration).toContain("USING ERRCODE = '23514'");
  });

  it('reuses the existing route 409 conflict mapping', () => {
    expect(amendmentRoute).toContain("code === '23514'");
    expect(amendmentRoute).toContain("String(error).includes('authority_amendment_lifecycle_conflict')");
    expect(amendmentRoute).toContain('{ status: 409 }');
  });

  it('pins why post-departure live mutation is unsafe in the current document model', () => {
    expect(acceptanceHelper).toContain('Re-acceptance is strictly a pre-departure control');
    expect(acceptanceHelper).toContain("eq(trips.status, 'pending')");
    expect(acceptanceHelper).toContain('isNull(trips.issuedAt)');
    expect(authorityPdf).toContain('startAt: authority.authority.validFrom');
    expect(authorityPdf).toContain('routeSummary: authority.authority.approvedRoute');
    expect(authorityPdf).toContain('documentVersion: authority.authority.version');
    expect(publicVerification).toContain('validFrom: tripAuthorities.validFrom');
    expect(publicVerification).toContain('origin: tripAuthorities.origin');
    expect(publicVerification).toContain('version: tripAuthorities.version');
  });
});
