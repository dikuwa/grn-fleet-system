/**
 * Shared public-site navigation definitions.
 *
 * The public site intentionally keeps the top-level navigation small. Product
 * detail lives on the homepage and is exposed through the Platform menu so a
 * visitor does not have to bounce between several pages that repeat the same
 * story.
 */

export interface PublicNavLink {
  label: string;
  href: string;
}

export const PLATFORM_NAV_LINKS: PublicNavLink[] = [
  { label: 'Platform Overview', href: '/#platform' },
  { label: 'Solutions', href: '/#solutions' },
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Operational Visibility', href: '/#operations' },
];

/** Primary desktop/mobile navigation after the Platform disclosure. */
export const PUBLIC_NAV_LINKS: PublicNavLink[] = [
  { label: 'Resources', href: '/faq' },
  { label: 'About', href: '/about' },
  { label: 'Contact', href: '/contact' },
];

/** Standardised action vocabulary — existing customer vs prospective customer. */
export const SIGN_IN_HREF = '/login';
export const REQUEST_DEMO_HREF = '/request-demo';

// ---------------------------------------------------------------------------
// Footer link groups
// ---------------------------------------------------------------------------

export const FOOTER_PLATFORM_LINKS: PublicNavLink[] = [
  { label: 'Platform Overview', href: '/#platform' },
  { label: 'Solutions', href: '/#solutions' },
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Request Demo', href: REQUEST_DEMO_HREF },
];

export const FOOTER_COMPANY_LINKS: PublicNavLink[] = [
  { label: 'About', href: '/about' },
  { label: 'Pilot Programme', href: '/about#pilot' },
  { label: 'Contact', href: '/contact' },
];

export const FOOTER_LEGAL_LINKS: PublicNavLink[] = [
  { label: 'Privacy Policy', href: '/privacy' },
];
