/**
 * Public site footer — shared across every public route.
 *
 * A structured footer with link groups, platform contact details from CMS
 * site settings (never hardcoded) and a short platform description.
 */

import Link from 'next/link';
import { Mail, Phone, MapPin } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import {
  FOOTER_PLATFORM_LINKS,
  FOOTER_SOLUTIONS_LINKS,
  FOOTER_COMPANY_LINKS,
  FOOTER_LEGAL_LINKS,
} from '@/components/public/nav';

export interface PublicFooterProps {
  siteName?: string;
  siteTagline?: string | null;
  description?: string;
  copyrightText?: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  address?: string | null;
}

export function PublicFooter({
  siteName = APP_NAME,
  siteTagline,
  description,
  copyrightText,
  contactEmail,
  contactPhone,
  address,
}: PublicFooterProps) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-brand-950">
      <div className="mx-auto max-w-[1200px] px-6 py-14">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-5">
          {/* Brand + description */}
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
                G
              </span>
              <span className="text-sm font-semibold text-white">
                {siteName}
              </span>
            </div>
            {(description || siteTagline) && (
              <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/60">
                {description || siteTagline}
              </p>
            )}
            <div className="mt-6 space-y-2.5">
              {contactEmail && (
                <a
                  href={`mailto:${contactEmail}`}
                  className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
                >
                  <Mail className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
                  {contactEmail}
                </a>
              )}
              {contactPhone && (
                <a
                  href={`tel:${contactPhone.replace(/[^+\d]/g, '')}`}
                  className="flex items-center gap-2 text-sm text-white/60 transition-colors hover:text-white"
                >
                  <Phone className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
                  {contactPhone}
                </a>
              )}
              {address && (
                <p className="flex items-center gap-2 text-sm text-white/60">
                  <MapPin className="h-4 w-4 shrink-0 text-white/40" aria-hidden="true" />
                  {address}
                </p>
              )}
            </div>
          </div>

          {/* Link groups */}
          <FooterGroup title="Platform" links={FOOTER_PLATFORM_LINKS} />
          <FooterGroup title="Solutions" links={FOOTER_SOLUTIONS_LINKS} />
          <FooterGroup title="Company" links={FOOTER_COMPANY_LINKS} />
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-4 border-t border-white/10 pt-8 md:flex-row">
          <p className="text-sm text-white/50">
            {copyrightText
              ? copyrightText.replace('{year}', String(year))
              : `© ${year} ${siteName}. All rights reserved.`}
          </p>
          <div className="flex flex-wrap items-center gap-6">
            {FOOTER_LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm text-white/50 transition-colors hover:text-white"
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

function FooterGroup({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <nav aria-label={`${title} links`}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={`${title}-${link.label}`}>
            <Link
              href={link.href}
              className="text-sm text-white/60 transition-colors hover:text-white"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
