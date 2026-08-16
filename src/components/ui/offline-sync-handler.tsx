'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { syncPendingDrafts } from '@/lib/offline-sync';
import { allowedOfflineDraftTypes } from '@/lib/offline-draft-policy';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';

/**
 * OfflineSyncHandler
 *
 * Mount this once in your layout (next to <OfflineIndicator />).
 * It listens for the browser's `online` event and attempts to sync
 * pending offline drafts that the current role set is still authorised to
 * create. It also runs a periodic sync every 60s and syncs immediately on
 * mount once the user profile is known.
 *
 * Drafts that became read-only after a role/policy change are deliberately
 * left in IndexedDB for the owner to inspect or discard; background reconnect
 * must never submit them silently.
 *
 * Renders nothing — zero visual footprint.
 */
export function OfflineSyncHandler() {
  const syncingRef = useRef(false);
  const { data: profile } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
  });

  useEffect(() => {
    if (!profile) return;

    const roleNames = profile.roles.map((role) => role.roleName);
    const draftTypes = allowedOfflineDraftTypes(roleNames);
    const scope = {
      userId: profile.id,
      tenantId: profile.tenantId,
      draftTypes,
    };

    async function runSync(trigger: 'mount' | 'online' | 'interval') {
      if (syncingRef.current || draftTypes.length === 0) return;
      syncingRef.current = true;

      try {
        const result = await syncPendingDrafts(scope);
        if (result.synced > 0 || result.failed > 0) {
          console.log(
            `[OfflineSync] ${trigger}: synced ${result.synced}, failed ${result.failed}`,
            result.errors.length > 0 ? result.errors : '',
          );
        }
      } finally {
        syncingRef.current = false;
      }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void runSync('mount');
    }

    const handleOnline = () => void runSync('online');
    window.addEventListener('online', handleOnline);

    const interval = setInterval(() => {
      if (!navigator.onLine) return;
      void runSync('interval');
    }, 60_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, [profile]);

  return null;
}
