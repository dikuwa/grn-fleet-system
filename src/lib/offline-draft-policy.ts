import { SystemRoles } from '@/lib/dashboard-access';
import type { OfflineDraft } from '@/lib/offline-drafts';

export type OfflineDraftType = OfflineDraft['draftType'];

/**
 * Return only draft types the current role set may actively create/sync.
 *
 * Drivers intentionally do not receive official inspection draft types. They
 * may view inspection records elsewhere, but departure/return inspections are
 * performed by authorised Inspector/Release Officer/Transport Admin roles.
 */
export function allowedOfflineDraftTypes(roleNames: string[]): OfflineDraftType[] {
  const allowed = new Set<OfflineDraftType>();

  if (roleNames.includes(SystemRoles.TRANSPORT_ADMIN)) {
    return [
      'fuel',
      'request',
      'trip_log',
      'trip_progress',
      'trip_incident',
      'trip_expense',
      'inspection_departure',
      'inspection_return',
    ];
  }

  if (roleNames.includes(SystemRoles.REQUESTER)) allowed.add('request');

  if (roleNames.includes(SystemRoles.DRIVER)) {
    allowed.add('fuel');
    allowed.add('trip_log');
    allowed.add('trip_progress');
    allowed.add('trip_incident');
    allowed.add('trip_expense');
  }

  if (roleNames.includes(SystemRoles.INSPECTOR) || roleNames.includes(SystemRoles.RELEASE_OFFICER)) {
    allowed.add('inspection_departure');
    allowed.add('inspection_return');
  }

  return [...allowed];
}

export function canSyncOfflineDraft(draftType: OfflineDraftType, roleNames: string[]) {
  return allowedOfflineDraftTypes(roleNames).includes(draftType);
}
