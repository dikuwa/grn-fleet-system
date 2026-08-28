import { describe, expect, it } from 'vitest';
import {
  CLEAN_SLATE_CATEGORIES,
  RESET_ALWAYS_PROTECTED,
  normalizeResetSpec,
} from '@/lib/reset-catalog';

describe('tenant reset catalogue', () => {
  it('makes clean slate suitable for manual QA without deleting tenant access or configuration', () => {
    expect(CLEAN_SLATE_CATEGORIES).toEqual([
      'operations',
      'documents',
      'programmes',
      'fleet',
      'people',
    ]);

    const spec = normalizeResetSpec({ preset: 'clean_slate', target: 'tenant' });

    expect(spec.categories).toEqual([
      'operations',
      'documents',
      'programmes',
      'fleet',
      'people',
    ]);
    expect(spec.categories).not.toContain('organisation');
    expect(spec.categories).not.toContain('access');
    expect(spec.categories).not.toContain('configuration');
  });

  it('continues to preserve the tenant shell and immutable history', () => {
    expect(RESET_ALWAYS_PROTECTED).toContain('Tenant identity and branding');
    expect(RESET_ALWAYS_PROTECTED).toContain('Organisation structure');
    expect(RESET_ALWAYS_PROTECTED).toContain('Roles, permissions and tenant configuration');
    expect(RESET_ALWAYS_PROTECTED).toContain('Audit history');
    expect(RESET_ALWAYS_PROTECTED).toContain('Global authentication accounts');
    expect(RESET_ALWAYS_PROTECTED).not.toContain('People, fleet and organisation master data');
  });
});
