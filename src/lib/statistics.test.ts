import { describe, expect, it } from 'vitest';
import { groupedCountMap, numericCount, sumGroupedCounts } from '@/lib/statistics';

describe('statistics normalization', () => {
  it('converts database count strings to numbers', () => {
    expect(numericCount('13')).toBe(13);
    expect(numericCount(7)).toBe(7);
    expect(numericCount(null)).toBe(0);
  });

  it('adds grouped string counts numerically instead of concatenating them', () => {
    const counts = groupedCountMap([
      { key: 'submitted', count: '0' },
      { key: 'supervisor_review', count: '13' },
      { key: 'transport_review', count: '14' },
    ]);

    expect(sumGroupedCounts(counts, ['submitted', 'supervisor_review', 'transport_review'])).toBe(
      27,
    );
  });
});
