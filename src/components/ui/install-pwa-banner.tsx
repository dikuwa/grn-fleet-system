'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X, Download } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * InstallPwaBanner
 *
 * Shows a banner prompting users to install the PWA when the browser
 * fires the `beforeinstallprompt` event. Dismissed banners stay hidden
 * for the session.
 *
 * Place near the bottom of the dashboard shell or page layout.
 */
export function InstallPwaBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(display-mode: standalone)').matches) {
      return true;
    }
    return false;
  });

  useEffect(() => {
    const handler = (e: Event) => {
      // Prevent the mini-infobar from appearing
      e.preventDefault();
      // Stash the event so we can trigger it later
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handler);

    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    console.log('[PWA] Install outcome:', outcome);

    setDeferredPrompt(null);
    if (outcome === 'accepted') {
      setDismissed(true);
    }
  };

  if (!deferredPrompt || dismissed) return null;

  return (
    <Card className="fixed bottom-4 right-4 z-50 w-72 shadow-lg border-brand-200 bg-white animate-in slide-in-from-bottom-4 duration-300">
      <CardContent className="pt-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-brand-50">
              <Download className="h-5 w-5 text-brand-700" />
            </div>
            <div>
              <p className="text-sm font-medium text-ink-950">Install App</p>
              <p className="text-xs text-ink-500">Get the best experience</p>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-ink-400 hover:text-ink-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3">
          <Button variant="primary" size="compact" onClick={handleInstall} className="w-full">
            <Download className="h-3.5 w-3.5" /> Install
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
