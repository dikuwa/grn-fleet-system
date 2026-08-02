'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X, Download, Smartphone, Share } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type PwaInstallState = 'installed' | 'can-install' | 'ios' | 'unsupported';

/**
 * usePwaInstallState
 *
 * Central detection for the PWA install experience:
 * - 'installed'    → running in standalone mode (or appinstalled fired)
 * - 'can-install'  → `beforeinstallprompt` fired, prompt() is available
 * - 'ios'          → iOS Safari (no beforeinstallprompt; needs manual steps)
 * - 'unsupported'  → no service worker / not installable
 */
export function usePwaInstallState(): {
  state: PwaInstallState;
  deferredPrompt: BeforeInstallPromptEvent | null;
  promptInstall: () => Promise<'accepted' | 'dismissed'>;
} {
  const [state, setState] = useState<PwaInstallState>('unsupported');
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const detectInstalled = () => {
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      // Preserve 'ios' and 'can-install' — only fall back to 'unsupported'
      // when we have no evidence of installability.
      setState((s) =>
        standalone ? 'installed' : s === 'ios' ? 'ios' : s === 'can-install' ? s : 'unsupported',
      );
    };

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setState('can-install');
    };
    const onInstalled = () => setState('installed');

    // iOS Safari: never fires beforeinstallprompt, but supports A2HS
    const ua = navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const iosTimer = isIos ? setTimeout(() => setState('ios'), 0) : null;

    detectInstalled();
    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);
    window.addEventListener('load', detectInstalled);

    return () => {
      if (iosTimer) clearTimeout(iosTimer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      window.removeEventListener('load', detectInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return 'dismissed' as const;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    if (outcome === 'accepted') setState('installed');
    else setState('unsupported'); // browsers won't re-fire beforeinstallprompt this session
    return outcome;
  }, [deferredPrompt]);

  return { state, deferredPrompt, promptInstall };
}

/**
 * InstallPwaBanner
 *
 * In-app install promotion. Shows a bottom-right card when the app is
 * installable (beforeinstallprompt) or the user is on iOS Safari.
 * Hides automatically once installed or unsupported. Dismissed banners
 * stay hidden for the session.
 */
export function InstallPwaBanner() {
  const { state, promptInstall } = usePwaInstallState();
  const [dismissed, setDismissed] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const dismissedAt = Number(localStorage.getItem('grn-pwa-banner-dismissed-at') || 0);
    if (Date.now() - dismissedAt < 7 * 24 * 60 * 60 * 1000) {
      const timer = window.setTimeout(() => setDismissed(true), 0);
      return () => window.clearTimeout(timer);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem('grn-pwa-banner-dismissed-at', String(Date.now()));
    setDismissed(true);
  };

  if (state === 'installed' || state === 'unsupported' || dismissed) return null;

  return (
    <>
      <Card className="animate-in slide-in-from-bottom-4 bg-surface border-border fixed inset-x-3 bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] z-40 border shadow-lg duration-300 sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-72">
        <CardContent className="pt-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-brand-50 flex h-10 w-10 items-center justify-center rounded-[8px]">
                <Download className="text-brand-700 h-5 w-5" />
              </div>
              <div>
                <p className="text-ink-950 text-sm font-medium">Install GovFleet App</p>
                <p className="text-ink-500 text-xs">Faster access, works offline</p>
              </div>
            </div>
            <button
              onClick={dismiss}
              className="touch-target text-ink-400 hover:text-ink-600 -mt-2 -mr-2 rounded-[8px] transition-colors"
              aria-label="Dismiss install prompt"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3">
            {state === 'can-install' ? (
              <Button variant="primary" size="compact" className="w-full" onClick={promptInstall}>
                <Download className="h-3.5 w-3.5" /> Install App
              </Button>
            ) : (
              <Button
                variant="primary"
                size="compact"
                className="w-full"
                onClick={() => setShowIosHelp(true)}
              >
                <Smartphone className="h-3.5 w-3.5" /> Install on iPhone
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <IosInstallDialog open={showIosHelp} onClose={() => setShowIosHelp(false)} />
    </>
  );
}

/**
 * IosInstallDialog — step-by-step iPhone/iPad add-to-home-screen instructions.
 */
export function IosInstallDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Install GovFleet on iPhone/iPad</DialogTitle>
          <DialogDescription>
            On iOS, use Safari&apos;s built-in Add to Home Screen:
          </DialogDescription>
        </DialogHeader>
        <ol className="text-ink-700 dark:text-ink-300 list-decimal space-y-2 pl-5 text-sm">
          <li>
            Tap the <Share className="text-ink-500 inline h-3.5 w-3.5" /> Share button in the Safari
            toolbar.
          </li>
          <li>
            Scroll down and tap <strong>Add to Home Screen</strong>.
          </li>
          <li>
            Tap <strong>Add</strong> (top right) to confirm.
          </li>
        </ol>
        <p className="text-ink-500 bg-muted mt-2 rounded-[8px] px-3 py-2 text-xs">
          The app icon will appear on your home screen and open in standalone mode.
        </p>
        <DialogFooter>
          <Button variant="primary" onClick={onClose}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
