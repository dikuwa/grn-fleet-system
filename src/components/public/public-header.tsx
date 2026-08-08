/**
 * Public site header — shared across every public route.
 *
 * The product story is intentionally consolidated under one Platform menu.
 * Desktop visitors can reveal it immediately on hover while click/focus
 * interactions remain available for keyboard and touch accessibility.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronDown, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { PublicMobileNav } from '@/components/public/public-mobile-nav';
import {
  PLATFORM_NAV_LINKS,
  PUBLIC_NAV_LINKS,
  REQUEST_DEMO_HREF,
  SIGN_IN_HREF,
} from '@/components/public/nav';
import { useEffect, useRef, useState } from 'react';

export interface PublicHeaderProps {
  siteName?: string;
  logoUrl?: string | null;
}

function isNavActive(href: string, pathname: string): boolean {
  const segment = href.split('#')[0];
  if (!segment || segment === '/') return pathname === '/';
  return pathname === segment || pathname.startsWith(`${segment}/`);
}

export function PublicHeader({
  siteName = APP_NAME,
  logoUrl,
}: PublicHeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [platformOpen, setPlatformOpen] = useState(false);
  const platformRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const platformActive = pathname === '/' || pathname === '/services';

  const cancelScheduledClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const openPlatform = () => {
    cancelScheduledClose();
    setPlatformOpen(true);
  };

  const schedulePlatformClose = () => {
    cancelScheduledClose();
    closeTimerRef.current = setTimeout(() => setPlatformOpen(false), 110);
  };

  useEffect(() => {
    setPlatformOpen(false);
  }, [pathname]);

  useEffect(() => {
    return () => cancelScheduledClose();
  }, []);

  useEffect(() => {
    if (!platformOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!platformRef.current?.contains(event.target as Node)) setPlatformOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPlatformOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [platformOpen]);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link
            href="/"
            className="focus-ring flex min-w-0 items-center gap-2.5 rounded-[8px]"
            aria-label={`${siteName} — home`}
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={siteName} className="h-8 w-8 rounded-lg object-contain" />
            ) : (
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-800 text-sm font-bold text-white">
                G
              </span>
            )}
            <span className="truncate text-sm font-semibold text-ink-950">{siteName}</span>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            <div
              ref={platformRef}
              className="relative"
              onMouseEnter={openPlatform}
              onMouseLeave={schedulePlatformClose}
              onFocusCapture={openPlatform}
              onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  schedulePlatformClose();
                }
              }}
            >
              <button
                type="button"
                onClick={() => setPlatformOpen((open) => !open)}
                aria-expanded={platformOpen}
                aria-haspopup="menu"
                className={cn(
                  'focus-ring inline-flex items-center gap-1.5 rounded-[8px] px-3 py-2 text-sm transition-colors motion-reduce:transition-none',
                  platformActive
                    ? 'bg-muted font-medium text-ink-950'
                    : 'text-ink-500 hover:bg-muted/60 hover:text-ink-950',
                )}
              >
                Platform
                <ChevronDown
                  className={cn('h-4 w-4 transition-transform motion-reduce:transition-none', platformOpen && 'rotate-180')}
                  aria-hidden="true"
                />
              </button>

              <div
                role="menu"
                className={cn(
                  'absolute left-0 top-[calc(100%+0.45rem)] w-64 origin-top-left rounded-[10px] border border-border bg-surface p-2 shadow-xl transition-[opacity,transform] duration-150 motion-reduce:transition-none',
                  platformOpen
                    ? 'visible translate-y-0 opacity-100'
                    : 'pointer-events-none invisible -translate-y-1 opacity-0',
                )}
              >
                {PLATFORM_NAV_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    role="menuitem"
                    onClick={() => setPlatformOpen(false)}
                    className="focus-ring flex rounded-[7px] px-3 py-2.5 text-sm text-ink-700 transition-colors hover:bg-muted hover:text-ink-950"
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            {PUBLIC_NAV_LINKS.map((link) => {
              const active = isNavActive(link.href, pathname);
              return (
                <Link
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-[8px] px-3 py-2 text-sm transition-colors motion-reduce:transition-none',
                    active
                      ? 'bg-muted font-medium text-ink-950'
                      : 'text-ink-500 hover:bg-muted/60 hover:text-ink-950',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2">
            <PublicThemeToggle />
            <Link
              href={SIGN_IN_HREF}
              className="hidden rounded-[8px] px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-muted hover:text-ink-950 sm:inline-flex"
            >
              Sign In
            </Link>
            <Link
              href={REQUEST_DEMO_HREF}
              className="hidden h-10 items-center justify-center rounded-[8px] bg-brand-800 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700 sm:inline-flex dark:hover:bg-brand-600"
            >
              Request Demo
            </Link>
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              aria-expanded={mobileOpen}
              aria-controls="public-mobile-nav"
              className="focus-ring -mr-2 flex h-11 w-11 items-center justify-center rounded-[8px] text-ink-700 transition-colors hover:bg-muted lg:hidden"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <PublicMobileNav
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        siteName={siteName}
        logoUrl={logoUrl}
      />
    </>
  );
}
