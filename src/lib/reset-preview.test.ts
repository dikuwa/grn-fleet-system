import { describe, expect, it } from 'vitest';
import { normalizeResetPreview } from './reset-preview';

const VALID = {
  dryRunSummary: { requests: 0, trips: 0, documents: 0, notifications: 0, total: 0 },
  steps: [],
  preserved: [],
  review: [],
  fingerprint: 'stable-plan-fingerprint',
  plannedAt: '2026-08-11T00:00:00.000Z',
};

describe('normalizeResetPreview', () => {
  it.each([null, undefined, {}, { dryRunSummary: {} }, { dryRunSummary: { total: 1 } }])(
    'rejects an incomplete JSONB placeholder: %j',
    (value) => expect(normalizeResetPreview(value)).toBeNull(),
  );

  it('accepts a valid zero-impact preview', () => {
    expect(normalizeResetPreview(VALID)?.dryRunSummary.total).toBe(0);
  });

  it('rejects a preview without a plan fingerprint', () => {
    expect(normalizeResetPreview({ ...VALID, fingerprint: '' })).toBeNull();
  });

  it('defaults optional detail arrays without breaking reset actions', () => {
    const result = normalizeResetPreview({
      dryRunSummary: VALID.dryRunSummary,
      fingerprint: VALID.fingerprint,
      plannedAt: VALID.plannedAt,
    });
    expect(result).toMatchObject({ steps: [], preserved: [], review: [] });
  });
});
