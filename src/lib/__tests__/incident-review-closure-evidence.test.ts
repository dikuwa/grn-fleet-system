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

describe('incident review closure evidence', () => {
  it('persists pending investigation evidence before final closure for investigators', () => {
    const closeStart = source.indexOf('async function closeInvestigation()');
    const saveCall = source.indexOf("action: 'investigation_update'", closeStart);
    const closeCall = source.indexOf(
      'fetch(`/api/incidents/${incidentId}/investigation`',
      closeStart,
    );

    expect(closeStart).toBeGreaterThan(-1);
    expect(source).toContain('if (canInvestigate)');
    expect(saveCall).toBeGreaterThan(closeStart);
    expect(closeCall).toBeGreaterThan(saveCall);
    expect(source).toContain('...form');
  });

  it('renders investigation evidence read-only after closure and for close-only reviewers', () => {
    expect(source).toContain(
      'initial.investigationClosedAt != null || (!canInvestigate && canClose)',
    );
    expect(source).toContain(
      '{canInvestigate && initial.investigationClosedAt == null && (',
    );
    expect(source).toContain('<CardTitle>Investigation evidence</CardTitle>');
    expect(source).toContain("{initial.policeReference || 'Not recorded'}");
    expect(source).toContain("{initial.investigationNotes || 'Not recorded'}");
    expect(source).toContain("{initial.administratorResponse || 'Not recorded'}");
  });
});
