import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const resubmit = readFileSync('src/app/api/requests/[id]/resubmit/route.ts', 'utf8');

describe('corrected request document refresh contract', () => {
  it('regenerates the Transport Request only after corrected resubmission is finalised', () => {
    expect(resubmit).toContain("import { onRequestSubmitted } from '@/lib/document-generator';");
    expect(resubmit).toContain('await onRequestSubmitted(id, session.tenantId, session.user.id)');

    const finalisationCheck = resubmit.indexOf("finalised.status !== 'submitted'");
    const documentRefresh = resubmit.indexOf(
      'await onRequestSubmitted(id, session.tenantId, session.user.id)',
    );
    expect(finalisationCheck).toBeGreaterThan(-1);
    expect(documentRefresh).toBeGreaterThan(finalisationCheck);
  });

  it('keeps document delivery best-effort after the governed request commit', () => {
    expect(resubmit).toContain(
      "console.warn('[request/resubmit] Corrected Transport Request document refresh failed:', documentError)",
    );
    expect(resubmit).toContain("action: 'request.resubmitted'");
    expect(resubmit.indexOf('await onRequestSubmitted(id, session.tenantId, session.user.id)')).toBeLessThan(
      resubmit.indexOf("action: 'request.resubmitted'"),
    );
  });
});
