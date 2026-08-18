import { describe, expect, it } from 'vitest';
import {
  isPublicEmployeeRequestEnabled,
  readPublicEmployeeRequestConfig,
  writePublicEmployeeRequestConfig,
} from '@/lib/public-request-access';

describe('public employee request access policy', () => {
  it('keeps existing tenants enabled by default', () => {
    expect(isPublicEmployeeRequestEnabled(undefined)).toBe(true);
    expect(isPublicEmployeeRequestEnabled({})).toBe(true);
  });

  it('honours an explicit disabled setting', () => {
    expect(
      isPublicEmployeeRequestEnabled({ publicEmployeeRequests: { enabled: false } }),
    ).toBe(false);
  });

  it('merges the setting without deleting unrelated tenant metadata', () => {
    const result = writePublicEmployeeRequestConfig({ billingNote: 'keep-me' }, false);
    expect(result.billingNote).toBe('keep-me');
    expect(readPublicEmployeeRequestConfig(result)).toEqual({ enabled: false });
  });
});
