/**
 * Shared public-site navigation definitions.
 *
 * The public website uses ONE navigation system across every public route.
 * Header, footer and mobile nav all resolve links from these constants so the
 * visitor never experiences different navigation paradigms per page.
 */

export interface PublicNavLink {
  label: string;
  href: string;
}

/** Primary desktop/mobile navigation (in display order). */
export const PUBLIC_NAV_LINKS: PublicNavLink[] = [
  { label: 'Platform', href: '/services' },
  { label: 'Solutions', href: '/services#solutions' },
  { label: 'How It Works', href: '/#how-it-works' },
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
  { label: 'Features', href: '/#features' },
  { label: 'How It Works', href: '/#how-it-works' },
  { label: 'Services', href: '/services' },
  { label: 'Request Demo', href: REQUEST_DEMO_HREF },
];

export const FOOTER_SOLUTIONS_LINKS: PublicNavLink[] = [
  { label: 'Government', href: '/services#solutions' },
  { label: 'Municipalities', href: '/services#solutions' },
  { label: 'Public Enterprises', href: '/services#solutions' },
  { label: 'Logistics & Private Fleets', href: '/services#solutions' },
];

export const FOOTER_COMPANY_LINKS: PublicNavLink[] = [
  { label: 'About', href: '/about' },
  { label: 'Pilot Programme', href: '/about#pilot' },
  { label: 'FAQ', href: '/faq' },
  { label: 'Contact', href: '/contact' },
];

export const FOOTER_LEGAL_LINKS: PublicNavLink[] = [
  { label: 'Privacy Policy', href: '/privacy' },
];
