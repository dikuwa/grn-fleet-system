/**
 * Public site footer — compact, functional and shared across public routes.
 */

import Link from 'next/link';
import { ExternalLink, Mail, MapPin, Phone } from 'lucide-react';
import { APP_NAME } from '@/lib/constants';
import {
  FOOTER_COMPANY_LINKS,
  FOOTER_LEGAL_LINKS,
  FOOTER_PLATFORM_LINKS,
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
      <div className="mx-auto max-w-[1200px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.6fr_0.8fr_0.8fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-700 text-sm font-bold text-white">
                G
              </span>
              <span className="text-sm font-semibold text-white">{siteName}</span>
            </div>
            {(description || siteTagline) && (
              <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">
                {description || siteTagline}
              </p>
            )}
            <div className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-x-5">
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

          <FooterGroup title="Platform" links={FOOTER_PLATFORM_LINKS} />
          <FooterGroup title="Company" links={FOOTER_COMPANY_LINKS} />
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-white/10 pt-7 text-sm md:flex-row md:items-center md:justify-between">
          <div className="space-y-2 text-white/50">
            <p>
              {copyrightText
                ? copyrightText.replace('{year}', String(year))
                : `© ${year} ${siteName}. All rights reserved.`}
            </p>
            <a
              href="https://www.flextech-media.com/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
            >
              Built by FlexTech Media
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-6">
            {FOOTER_LEGAL_LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-white/50 transition-colors hover:text-white">
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterGroup({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <nav aria-label={`${title} links`}>
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <ul className="mt-4 space-y-2.5">
        {links.map((link) => (
          <li key={`${title}-${link.label}`}>
            <Link href={link.href} className="text-sm text-white/60 transition-colors hover:text-white">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
