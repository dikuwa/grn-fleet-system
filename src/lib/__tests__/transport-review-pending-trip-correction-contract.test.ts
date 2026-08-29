import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const correctionRoute = readFileSync(
  'src/app/api/requests/[id]/transport-review-correction/route.ts',
  'utf8',
);
const documentGenerator = readFileSync('src/lib/document-generator-core.ts', 'utf8');

function lifecycleLockBlock() {
  const start = correctionRoute.indexOf('if (allocation) {');
  const end = correctionRoute.indexOf(
    '\n\n      if (scheduleChanged && allocation && nextStart && nextEnd)',
    start,
  );
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return correctionRoute.slice(start, end);
}

describe('Transport Review pending-trip correction boundary', () => {
  it('does not treat a merely pending trip as an immutable lifecycle boundary', () => {
    const block = lifecycleLockBlock();

    expect(block).toContain('status: trips.status');
    expect(block).toContain("trip.status !== 'pending'");
    expect(block).toContain('trip.issuedAt');
    expect(block).toContain('trip.driverAcknowledgedAt');
    expect(block).not.toContain('if (trip || authority)');
  });

  it('keeps authorised, issued, accepted, or non-draft authority state locked', () => {
    const block = lifecycleLockBlock();

    expect(block).toContain('status: tripAuthorities.status');
    expect(block).toContain("authority.status !== 'draft'");
    expect(block).toContain('authority.issuedAt');
    expect(block).toContain('authority.authorisedAt');
    expect(block).toContain('authority.acceptedAt');
    expect(block).toContain('if (tripLocked || authorityLocked)');
  });

  it('refreshes the mutable draft Trip Authority after committed corrections', () => {
    expect(correctionRoute).toContain("import { onTripIssued } from '@/lib/document-generator'");
    expect(correctionRoute).toContain('allocationId: allocation?.id ?? null');
    expect(correctionRoute).toContain(
      'await onTripIssued(result.allocationId, session.tenantId, session.user.id)',
    );

    expect(documentGenerator).toContain('A pending draft is mutable working state');
    expect(documentGenerator).toContain("existing?.status === 'draft'");
    expect(documentGenerator).toContain('UPDATE generated_documents');
  });
});
