const ACTIVE_RESET_STATUSES = new Set(['draft', 'pending_review', 'approved', 'in_progress']);

export function recoveryPointReleaseBlockReason(
  input: {
    action: 'delete' | 'unprotect';
    isProtected: boolean;
    backupStatus: string;
    source: string;
    expiresAt: Date | null;
    resetStatus: string | null;
  },
  now = new Date(),
) {
  if (!['creating', 'ready'].includes(input.backupStatus)) return null;
  if (input.action === 'delete' && input.isProtected) {
    return 'Protected backups must be unprotected before deletion';
  }
  if (input.resetStatus && ACTIVE_RESET_STATUSES.has(input.resetStatus)) {
    return 'This recovery point is required by an active reset and cannot be released';
  }
  if (input.source === 'pre_reset' && input.expiresAt && input.expiresAt > now) {
    return `This reset recovery point remains protected until ${input.expiresAt.toLocaleDateString('en-NA')}`;
  }
  return null;
}
