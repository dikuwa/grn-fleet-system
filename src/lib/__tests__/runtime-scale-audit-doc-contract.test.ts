import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const audit = readFileSync('docs/audits/runtime-scale-closure-2026-08-30.md', 'utf8');

describe('runtime scale audit record', () => {
  it('keeps unresolved scale findings explicit until their dedicated fixes land', () => {
    expect(audit).toContain('Programme selection at tenant scale');
    expect(audit).toContain('more than 500 current approved/published programmes');
    expect(audit).toContain('Staff import transaction scale');
    expect(audit).toContain('10,000-row maximum');
  });
});
