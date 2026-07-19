'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for offline support and background sync.
 *
 * Improvements over the previous version:
 * - No aggressive unregister-first on every load (caused SW churn)
 * - Uses updateViaCache: 'none' for instant SW updates
 * - Registers a 'sync' event handler for background sync
 * - Only runs in production
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;

    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js', {
        scope: '/',
        updateViaCache: 'none',
      })
      .then(async (reg) => {
        console.log('[SW] Registered:', reg.scope);

        // Check for SW updates periodically (every hour)
        setInterval(() => {
          reg.update().catch(() => {});
        }, 60 * 60 * 1000);

        // Register background sync for offline drafts
        const swReg = reg as unknown as { sync?: { register: (tag: string) => Promise<void> } };
        if (swReg.sync) {
          try {
            await swReg.sync.register('sync-offline-drafts');
          } catch {
            // Background Sync not supported — fall back to periodic sync
          }
        }
      })
      .catch((err) => {
        console.error('[SW] Registration failed:', err);
      });
  }, []);

  return null;
}
