/**
 * Public mobile navigation — accessible, compact and intentionally grouped.
 *
 * The Platform product story is exposed as a nested section so mobile users
 * can jump to the relevant homepage area without loading duplicate pages.
 */

'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import {
  PLATFORM_NAV_LINKS,
  PUBLIC_NAV_LINKS,
  REQUEST_DEMO_HREF,
  SIGN_IN_HREF,
} from '@/components/public/nav';
import { cn } from '@/lib/utils';

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
  const [platformOpen, setPlatformOpen] = useState(true);

  useEffect(() => {
    if (!open) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = prevOverflow;
      restoreFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = Array.from(
          panelRef.current.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
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
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/55 backdrop-blur-md"
        tabIndex={-1}
      />

      <div
        ref={panelRef}
        className="absolute inset-x-0 top-0 flex max-h-[100dvh] flex-col overflow-y-auto border-b border-border bg-surface shadow-xl"
      >
        <div className="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-2.5">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={siteName} className="h-8 w-8 rounded-lg object-contain" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-sm font-bold text-white">
                G
              </span>
            )}
            <span className="truncate text-sm font-semibold text-ink-950">{siteName}</span>
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

        <nav aria-label="Main" className="flex flex-col px-4 py-4">
          <button
            type="button"
            onClick={() => setPlatformOpen((current) => !current)}
            aria-expanded={platformOpen}
            className="focus-ring flex min-h-12 items-center justify-between rounded-[8px] px-3 text-left text-[15px] font-semibold text-ink-900 hover:bg-muted"
          >
            Platform
            <ChevronDown
              className={cn('h-4 w-4 text-ink-400 transition-transform motion-reduce:transition-none', platformOpen && 'rotate-180')}
              aria-hidden="true"
            />
          </button>

          {platformOpen && (
            <div className="mb-2 ml-3 border-l border-border pl-3">
              {PLATFORM_NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={onClose}
                  className="focus-ring flex min-h-11 items-center rounded-[8px] px-3 text-sm text-ink-600 transition-colors hover:bg-muted hover:text-ink-950"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          )}

          {PUBLIC_NAV_LINKS.map((link) => (
            <Link
              key={`${link.label}-${link.href}`}
              href={link.href}
              onClick={onClose}
              className="focus-ring flex min-h-12 items-center rounded-[8px] px-3 text-[15px] font-medium text-ink-800 transition-colors hover:bg-muted"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex shrink-0 flex-col gap-3 border-t border-border px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+2rem)] sm:px-6">
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
