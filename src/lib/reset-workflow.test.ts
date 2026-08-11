import { describe, expect, it } from 'vitest';
import {
  matchesTenantExecutionResetPhrase,
  matchesTenantResetRequestPhrase,
  tenantExecutionResetPhrase,
  TENANT_RESET_REQUEST_PHRASE,
} from './reset-workflow';

describe('tenant-to-platform reset confirmation phrases', () => {
  it('requires the exact tenant request phrase', () => {
    expect(TENANT_RESET_REQUEST_PHRASE).toBe('REQUEST RESET');
    expect(matchesTenantResetRequestPhrase('REQUEST RESET')).toBe(true);
    expect(matchesTenantResetRequestPhrase('request reset')).toBe(false);
    expect(matchesTenantResetRequestPhrase('REQUEST')).toBe(false);
  });

  it('binds final execution to the specific tenant code', () => {
    expect(tenantExecutionResetPhrase('KERC')).toBe('RESET KERC');
    expect(matchesTenantExecutionResetPhrase('RESET KERC', 'KERC')).toBe(true);
    expect(matchesTenantExecutionResetPhrase('RESET OTHER', 'KERC')).toBe(false);
    expect(matchesTenantExecutionResetPhrase('reset KERC', 'KERC')).toBe(false);
  });
});
