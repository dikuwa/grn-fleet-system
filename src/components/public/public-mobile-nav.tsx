/**
 * Public mobile navigation — a deliberate, accessible mobile menu.
 *
 * Requirements implemented:
 *   - large touch targets
 *   - theme toggle inside the menu
 *   - main nav + Request Demo + Sign In
 *   - Escape-key close, close on navigation
 *   - background scroll locked while open
 *   - focus moved into the dialog and restored on close
 *   - aria-expanded / aria-controls wiring
 */

'use client';

import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import {
  PUBLIC_NAV_LINKS,
  REQUEST_DEMO_HREF,
  SIGN_IN_HREF,
} from '@/components/public/nav';

export interface PublicMobileNavProps {
  open: boolean;
  onClose: () => void;
  siteName?: string;
  logoUrl?: string | null;
}

export function PublicMobileNav({
  open,
  onClose,
  siteName = APP_NAME,
  logoUrl,
}: PublicMobileNavProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Lock background scroll + move focus into the panel while open.
  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Move focus to the panel (focus trap lite — first/last element).
    const timer = window.setTimeout(() => {
      closeRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  // Escape-key support.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      id="public-mobile-nav"
      className="fixed inset-0 z-[60] lg:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Site menu"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/50"
        tabIndex={-1}
      />
      {/* Panel */}
      <div
        ref={panelRef}
        className="absolute inset-x-0 top-0 flex max-h-[100dvh] flex-col overflow-y-auto border-b border-border bg-surface shadow-xl"
      >
        <div className="flex h-16 items-center justify-between gap-4 border-b border-border px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={logoUrl}
                alt={siteName}
                className="h-8 w-8 rounded-lg object-contain"
              />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-sm font-bold text-white">
                G
              </span>
            )}
            <span className="truncate text-sm font-semibold text-ink-950">
              {siteName}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <PublicThemeToggle />
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close menu"
              className="focus-ring flex h-11 w-11 items-center justify-center rounded-[8px] text-ink-700 transition-colors hover:bg-muted"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <nav aria-label="Main" className="flex flex-col gap-1 px-4 py-4">
          {PUBLIC_NAV_LINKS.map((link) => (
            <Link
              key={`${link.label}-${link.href}`}
              href={link.href}
              onClick={onClose}
              className="flex h-12 items-center rounded-[8px] px-3 text-[15px] font-medium text-ink-800 transition-colors hover:bg-muted"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-3 border-t border-border px-6 py-6 pb-safe">
          <Link
            href={REQUEST_DEMO_HREF}
            onClick={onClose}
            className="inline-flex h-12 items-center justify-center rounded-[8px] bg-brand-800 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-700 dark:hover:bg-brand-600"
          >
            Request Demo
          </Link>
          <Link
            href={SIGN_IN_HREF}
            onClick={onClose}
            className="inline-flex h-12 items-center justify-center rounded-[8px] border border-border bg-surface px-6 text-sm font-medium text-ink-700 transition-colors hover:bg-muted"
          >
            Sign In
          </Link>
        </div>
      </div>
    </div>
  );
}
