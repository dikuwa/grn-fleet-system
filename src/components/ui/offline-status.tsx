'use client';

import { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, Database } from 'lucide-react';
import { countUnsyncedDrafts } from '@/lib/offline-drafts';

export function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [unsyncedCount, setUnsyncedCount] = useState(0);

  useEffect(() => {
    function handleOnline() { setIsOnline(true); }
    function handleOffline() { setIsOnline(false); }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Poll unsynced count separately
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const count = await countUnsyncedDrafts();
        if (!cancelled) setUnsyncedCount(count);
      } catch { /* Dexie not available */ }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  if (isOnline && unsyncedCount === 0) return null;

  return (
    <div
      data-testid="offline-indicator"
      className={`fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium shadow-lg backdrop-blur-sm transition-all ${
        isOnline
          ? 'bg-amber-100 text-amber-800'
          : 'bg-status-error-bg text-status-error-text'
      }`}
    >
      {isOnline ? (
        <>
          <RefreshCw className="h-3 w-3 animate-spin" />
          {unsyncedCount} draft{unsyncedCount !== 1 ? 's' : ''} pending sync
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3" />
          Offline — drafts saved locally
        </>
      )}
    </div>
  );
}

export function DraftBanner({ draftCount }: { draftCount: number }) {
  if (draftCount === 0) return null;

  return (
    <div className="flex items-center gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
      <Database className="h-3.5 w-3.5" />
      {draftCount} offline draft{draftCount !== 1 ? 's' : ''} saved locally.
      They will sync when you are back online.
    </div>
  );
}
