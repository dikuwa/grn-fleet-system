import { describe, expect, it } from 'vitest';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';

describe('filter state', () => {
  it('normalizes empty and All values to the unfiltered state', () => {
    expect(normalizeOptionalFilter('')).toBeUndefined();
    expect(normalizeOptionalFilter(' all ')).toBeUndefined();
    expect(normalizeOptionalFilter('regional')).toBe('regional');
  });

  it('detects active filters without treating pagination as a filter', () => {
    expect(hasActiveFilters({ page: '2', status: '', scope: 'all' })).toBe(false);
    expect(hasActiveFilters({ page: '2', status: 'submitted' })).toBe(true);
  });

  it('removes cleared values and resets pagination through overrides', () => {
    expect(
      buildFilterUrl(
        '/dashboard/requests',
        { search: 'vehicle', status: 'submitted', page: '3' },
        { status: undefined, page: undefined },
      ),
    ).toBe('/dashboard/requests?search=vehicle');
  });
});
