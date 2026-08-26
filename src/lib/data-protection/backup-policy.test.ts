import { describe, expect, it } from 'vitest';
import { recoveryPointReleaseBlockReason } from './backup-policy';

const NOW = new Date('2026-08-23T12:00:00.000Z');

describe('recovery point release policy', () => {
  it('blocks deletion of an explicitly protected recovery point', () => {
    expect(
      recoveryPointReleaseBlockReason(
        {
          action: 'delete',
          isProtected: true,
          backupStatus: 'ready',
          source: 'manual',
          expiresAt: null,
          resetStatus: null,
        },
        NOW,
      ),
    ).toMatch(/Protected/);
  });

  it.each(['draft', 'pending_review', 'approved', 'in_progress'])(
    'blocks recovery points referenced by an active %s reset',
    (resetStatus) => {
      expect(
        recoveryPointReleaseBlockReason(
          {
            action: 'unprotect',
            isProtected: true,
            backupStatus: 'ready',
            source: 'pre_reset',
            expiresAt: new Date('2026-08-01T00:00:00.000Z'),
            resetStatus,
          },
          NOW,
        ),
      ).toMatch(/active reset/);
    },
  );

  it('retains the clean-slate recovery point through its rollback window', () => {
    expect(
      recoveryPointReleaseBlockReason(
        {
          action: 'unprotect',
          isProtected: true,
          backupStatus: 'ready',
          source: 'pre_reset',
          expiresAt: new Date('2026-11-21T12:00:00.000Z'),
          resetStatus: 'completed',
        },
        NOW,
      ),
    ).toMatch(/remains protected/);
  });

  it('allows an obsolete unprotected point to be deleted after its reset window', () => {
    expect(
      recoveryPointReleaseBlockReason(
        {
          action: 'delete',
          isProtected: false,
          backupStatus: 'ready',
          source: 'pre_reset',
          expiresAt: new Date('2026-08-01T00:00:00.000Z'),
          resetStatus: 'completed',
        },
        NOW,
      ),
    ).toBeNull();
  });

  it('allows failed recovery attempts to be removed from history', () => {
    expect(
      recoveryPointReleaseBlockReason(
        {
          action: 'delete',
          isProtected: false,
          backupStatus: 'failed',
          source: 'pre_reset',
          expiresAt: new Date('2026-11-21T12:00:00.000Z'),
          resetStatus: 'approved',
        },
        NOW,
      ),
    ).toBeNull();
  });
});
