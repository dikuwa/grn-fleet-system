'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { syncPendingDrafts } from '@/lib/offline-sync';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';

/**
 * OfflineSyncHandler
 *
 * Mount this once in your layout (next to <OfflineIndicator />).
 * It listens for the browser's `online` event and attempts to sync
 * all pending offline drafts. It also runs a periodic sync every 60s
 * so drafts submitted while offline eventually get pushed, and — most
 * importantly — it syncs immediately on mount once the user profile is
 * known, so a draft saved during a previous offline session is pushed
 * as soon as the app loads rather than waiting for the next event.
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
    const scope = { userId: profile.id, tenantId: profile.tenantId };

    async function runSync(trigger: 'mount' | 'online' | 'interval') {
      if (syncingRef.current) return;
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

    // Sync immediately once the profile is known (the browser is online at
    // this point, otherwise the page could not have loaded). This catches
    // drafts left over from a previous offline session deterministically.
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void runSync('mount');
    }

    // Sync on connectivity restore
    const handleOnline = () => void runSync('online');
    window.addEventListener('online', handleOnline);

    // Periodic sync every N seconds (so it catches drafts saved while
    // the user was filling a form and then went back online)
    const interval = setInterval(async () => {
      if (!navigator.onLine) return;
      void runSync('interval');
    }, 60_000); // Every 60 seconds

    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, [profile]);

  return null;
}
