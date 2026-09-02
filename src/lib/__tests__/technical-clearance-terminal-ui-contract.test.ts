import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  resolve(process.cwd(), 'src/components/incidents/TechnicalClearanceForm.tsx'),
  'utf8',
);

describe('technical clearance terminal UI contract', () => {
  it('does not offer revocation after clearance has been granted', () => {
    expect(source).not.toContain('Revoke clearance (not cleared)');
    expect(source).toContain('Granted technical clearance is final for this safety review.');
    expect(source).toContain('record a new defect or incident');
  });

  it('keeps a not-cleared decision recoverable after re-inspection', () => {
    expect(source).toContain('{isAlreadyCleared ? (');
    expect(source).toContain("{isNotCleared ? 'Issue clearance after re-inspection'");
    expect(source).toContain('After the blocking defect is resolved and the vehicle is re-inspected');
  });

  it('requires the dedicated clearance capability before exposing mutation controls', () => {
    expect(source).toContain('canTechnicalClearance: boolean');
    expect(source).toContain('{canTechnicalClearance ? (');
    expect(source).toContain('if (!canTechnicalClearance) return;');
    expect(source).toContain('Technical clearance actions are available only to authorised clearance officers.');
  });

  it('uses the neutral decision label for either recorded outcome', () => {
    expect(source).toContain('Decision recorded by:');
    expect(source).not.toContain('Cleared by:');
  });
});
