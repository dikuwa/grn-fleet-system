import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const audit = readFileSync('docs/audits/runtime-scale-closure-2026-08-30.md', 'utf8');

describe('runtime scale audit record', () => {
  it('keeps only unresolved scale findings in follow-up while recording resolved guards', () => {
    expect(audit).toContain('Programme selection at tenant scale');
    expect(audit).toContain('more than 500 current approved/published programmes');
    expect(audit).toContain('synchronous batch ceiling of 500 rows');
    expect(audit).toContain('HTTP 413 before database acquisition');
    expect(audit).not.toContain('10,000-row maximum');
    expect(audit).not.toContain('### Staff import transaction scale');
  });
});
