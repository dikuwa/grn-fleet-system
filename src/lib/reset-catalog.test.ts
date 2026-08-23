import { describe, expect, it } from 'vitest';
import { normalizeResetSpec, resolveResetCategories, resetScopeForSpec } from './reset-catalog';

describe('reset catalog', () => {
  it('keeps the legacy operational preset compatible', () => {
    expect(normalizeResetSpec(undefined)).toMatchObject({
      preset: 'operational',
      categories: ['operations'],
      cutoff: null,
    });
  });

  it('resolves transitive clean-slate dependencies deterministically', () => {
    expect(resolveResetCategories(['organisation'])).toEqual({
      categories: ['operations', 'fleet', 'people', 'organisation', 'configuration'],
      autoIncludedCategories: ['operations', 'fleet', 'people', 'configuration'],
    });
  });

  it('defines clean slate as a go-live operational cleanup, not a tenant-shell wipe', () => {
    expect(normalizeResetSpec({ preset: 'clean_slate' })).toMatchObject({
      categories: ['operations', 'documents', 'programmes'],
      requestedCategories: ['operations', 'documents', 'programmes'],
    });
  });

  it('accepts a past cutoff and rejects future cutoffs', () => {
    expect(
      normalizeResetSpec({ preset: 'selective', categories: ['operations'], cutoff: '2020-01-01' })
        .cutoff,
    ).toBe('2020-01-01T00:00:00.000Z');
    expect(() =>
      normalizeResetSpec({ preset: 'selective', categories: ['operations'], cutoff: '2999-01-01' }),
    ).toThrow('past');
    expect(
      normalizeResetSpec({ preset: 'selective', categories: ['fleet'], cutoff: '2020-01-01' })
        .cutoff,
    ).toBeNull();
  });

  it('derives the existing broad scope from the resolved risk', () => {
    expect(
      resetScopeForSpec(normalizeResetSpec({ preset: 'selective', categories: ['fleet'] })),
    ).toBe('fleet');
    expect(
      resetScopeForSpec(normalizeResetSpec({ preset: 'selective', categories: ['access'] })),
    ).toBe('user_access');
    expect(resetScopeForSpec(normalizeResetSpec({ preset: 'clean_slate' }))).toBe('full');
  });
});
