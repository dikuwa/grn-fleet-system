/**
 * Public CMS footer component.
 *
 * Renders a standard footer with copyright, site name and navigation links.
 * Uses site settings from CMS when available (siteName, etc.) or falls
 * back to hardcoded defaults.
 */

import Link from 'next/link';
import { APP_NAME } from '@/lib/constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FooterSectionProps {
  siteName?: string;
  links?: Array<{ label: string; href: string }>;
  className?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_LINKS = [
  { label: 'About', href: '/about' },
  { label: 'Services', href: '/services' },
  { label: 'Privacy', href: '/privacy' },
  { label: 'Contact', href: '/contact' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FooterSection({
  siteName = APP_NAME,
  links = DEFAULT_LINKS,
  className = '',
}: FooterSectionProps) {
  return (
    <footer className={`bg-brand-950 py-12 ${className}`}>
      <div className="mx-auto max-w-[1200px] px-6">
        <div className="flex flex-col items-center justify-between gap-4 md:flex-row">
          <p className="text-sm text-white/60">
            &copy; {new Date().getFullYear()} {siteName}. All rights reserved.
          </p>
          <div className="flex gap-6">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-white/60 hover:text-white transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}