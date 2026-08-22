import { describe, expect, it } from 'vitest';
import {
  matchesTenantExecutionResetPhrase,
  matchesTenantResetRequestPhrase,
  tenantExecutionResetPhrase,
  TENANT_RESET_REQUEST_PHRASE,
  PLATFORM_EXECUTION_RESET_PHRASE,
  matchesPlatformExecutionResetPhrase,
  resetExecutionOwner,
} from './reset-workflow';
import { isResetRequestBlocking } from './reset-execution-guard';

describe('tenant-to-platform reset confirmation phrases', () => {
  it('does not let an expired approval permanently block a new request', () => {
    const now = new Date('2026-08-22T12:00:00.000Z');
    expect(
      isResetRequestBlocking(
        { status: 'approved', reviewedAt: new Date('2026-08-18T12:00:00.000Z') },
        now,
      ),
    ).toBe(false);
    expect(
      isResetRequestBlocking(
        { status: 'approved', reviewedAt: new Date('2026-08-21T12:00:00.000Z') },
        now,
      ),
    ).toBe(true);
    expect(isResetRequestBlocking({ status: 'pending_review', reviewedAt: null }, now)).toBe(true);
  });

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

  it('requires the exact platform operational reset phrase', () => {
    expect(PLATFORM_EXECUTION_RESET_PHRASE).toBe('RESET PLATFORM');
    expect(matchesPlatformExecutionResetPhrase('RESET PLATFORM')).toBe(true);
    expect(matchesPlatformExecutionResetPhrase('reset platform')).toBe(false);
    expect(matchesPlatformExecutionResetPhrase('RESET KERC')).toBe(false);
  });

  it('hands only tenant-originated operational/selective plans back to the tenant', () => {
    expect(resetExecutionOwner({ createdFrom: 'tenant_admin', preset: 'operational' })).toBe(
      'tenant',
    );
    expect(resetExecutionOwner({ createdFrom: 'tenant_admin', preset: 'selective' })).toBe(
      'tenant',
    );
    expect(resetExecutionOwner({ createdFrom: 'tenant_admin', preset: 'clean_slate' })).toBe(
      'platform',
    );
    expect(resetExecutionOwner({ createdFrom: 'platform_admin', preset: 'operational' })).toBe(
      'platform',
    );
  });
});
