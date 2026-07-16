'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker for offline support.
 * Only registers in production to avoid stale caches during development.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    // Only register in production to prevent stale caches during dev
    if (process.env.NODE_ENV !== 'production') return;

    if ('serviceWorker' in navigator) {
      // Unregister any existing SW first to ensure clean state
      navigator.serviceWorker.getRegistrations().then((regs) => {
        for (const reg of regs) {
          reg.unregister();
        }
      });

      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('Service Worker registered:', reg.scope);
        })
        .catch((err) => {
          console.error('Service Worker registration failed:', err);
        });
    }
  }, []);

  return null;
}
