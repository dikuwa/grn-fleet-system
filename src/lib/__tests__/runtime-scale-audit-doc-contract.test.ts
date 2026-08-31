import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const audit = readFileSync('docs/audits/runtime-scale-closure-2026-08-30.md', 'utf8');

describe('runtime scale audit record', () => {
  it('records the closed runtime-scale guards without stale follow-up findings', () => {
    expect(audit).toContain('synchronous batch ceiling of 500 rows');
    expect(audit).toContain('HTTP 413 before database acquisition');
    expect(audit).toContain('server-backed searchable combobox with 20-row requested windows');
    expect(audit).toContain('selected programme is hydrated directly by ID');
    expect(audit).toContain('No unresolved runtime-scale findings remain from this closure slice.');
    expect(audit).not.toContain('10,000-row maximum');
    expect(audit).not.toContain('more than 500 current approved/published programmes');
    expect(audit).not.toContain('### Staff import transaction scale');
    expect(audit).not.toContain('### Programme selection at tenant scale');
  });
});
