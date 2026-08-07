/**
 * Public site header — shared across every public route.
 *
 * Sticky, restrained and theme-aware. Desktop nav, theme toggle, Sign In and
 * Request Demo on the right; mobile menu on small screens. The header is a
 * client component only where interaction requires it (pathname highlighting
 * and the mobile menu).
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { cn } from '@/lib/utils';
import { APP_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { PublicMobileNav } from '@/components/public/public-mobile-nav';
import {
  PUBLIC_NAV_LINKS,
  REQUEST_DEMO_HREF,
  SIGN_IN_HREF,
} from '@/components/public/nav';
import { useState } from 'react';

export interface PublicHeaderProps {
  siteName?: string;
  logoUrl?: string | null;
}

/** Resolve whether a nav link is "active" for the current pathname. */
function isNavActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  if (href.startsWith('/#')) {
    // Anchor to the homepage — active only while on the homepage.
    return pathname === '/' || pathname.startsWith('/services');
  }
  // Segment-aware: /about matches /about and any sub-path.
  const segment = href.split('#')[0];
  if (pathname === segment) return true;
  if (segment !== '/' && pathname.startsWith(`${segment}/`)) return true;
  return false;
}

export function PublicHeader({
  siteName = APP_NAME,
  logoUrl,
}: PublicHeaderProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-border bg-surface/95 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between gap-4 px-6">
          {/* Brand */}
          <Link
            href="/"
            className="flex min-w-0 items-center gap-2.5 focus-ring rounded-[8px]"
            aria-label={`${siteName} — home`}
          >
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
          </Link>

          {/* Desktop navigation */}
          <nav
            aria-label="Main"
            className="hidden items-center gap-1 lg:flex"
          >
            {PUBLIC_NAV_LINKS.map((link) => {
              const active = isNavActive(link.href, pathname);
              return (
                <Link
                  key={`${link.label}-${link.href}`}
                  href={link.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'rounded-[8px] px-3 py-2 text-sm transition-colors',
                    active
                      ? 'font-medium text-ink-950 bg-muted'
                      : 'text-ink-500 hover:bg-muted/60 hover:text-ink-950',
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>

          {/* Right actions */}
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
            {/* Mobile menu trigger */}
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
