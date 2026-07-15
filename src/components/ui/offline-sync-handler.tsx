'use client';

import { useEffect, useRef } from 'react';
import { syncPendingDrafts } from '@/lib/offline-sync';

/**
 * OfflineSyncHandler
 *
 * Mount this once in your layout (next to <OfflineIndicator />).
 * It listens for the browser's `online` event and attempts to sync
 * all pending offline drafts. It also runs a periodic sync every 60s
 * so drafts submitted while offline eventually get pushed.
 *
 * Renders nothing — zero visual footprint.
 */
export function OfflineSyncHandler() {
  const syncingRef = useRef(false);

  useEffect(() => {
    // Sync on connectivity restore
    async function handleOnline() {
      if (syncingRef.current) return;
      syncingRef.current = true;

      try {
        const result = await syncPendingDrafts();
        if (result.synced > 0 || result.failed > 0) {
          console.log(
            `[OfflineSync] Synced ${result.synced}, failed ${result.failed}`,
            result.errors.length > 0 ? result.errors : '',
          );
        }
      } finally {
        syncingRef.current = false;
      }
    }

    window.addEventListener('online', handleOnline);

    // Periodic sync every N seconds (so it catches drafts saved while
    // the user was filling a form and then went back online)
    const interval = setInterval(async () => {
      if (!navigator.onLine || syncingRef.current) return;
      syncingRef.current = true;

      try {
        await syncPendingDrafts();
      } finally {
        syncingRef.current = false;
      }
    }, 60_000); // Every 60 seconds

    return () => {
      window.removeEventListener('online', handleOnline);
      clearInterval(interval);
    };
  }, []);

  return null;
}
