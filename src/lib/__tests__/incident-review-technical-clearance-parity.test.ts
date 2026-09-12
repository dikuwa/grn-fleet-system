import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync(
  path.join(
    process.cwd(),
    'src/app/(dashboard)/dashboard/trips/incidents/[id]/incident-review-actions.tsx',
  ),
  'utf8',
);

describe('MVA review technical-clearance parity', () => {
  it('routes both clearance decisions through the dedicated governed endpoint', () => {
    expect(source).toContain(
      'async function submitTechnicalClearance(status: \'cleared\' | \'not_cleared\')',
    );
    expect(source).toContain(
      'fetch(`/api/incidents/${incidentId}/technical-clearance`',
    );
    expect(source).toContain("body: JSON.stringify({ status })");
  });

  it('exposes a not-cleared decision before terminal clearance and preserves re-inspection recovery', () => {
    expect(source).toContain("| 'technical_not_cleared'");
    expect(source).toContain('Mark vehicle as not cleared?');
    expect(source).toContain('>Not cleared</Button>');
    expect(source).toContain("initial.technicalClearanceStatus !== 'not_cleared'");
    expect(source).toContain("'Issue clearance after re-inspection'");
  });
});
