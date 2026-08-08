/**
 * Extended public-site content.
 *
 * The `cms_site_settings` table exposes a flexible `metadata` jsonb column.
 * This module owns the *typed* shape of the public-facing content stored there
 * (under the reserved `publicSite` key), plus:
 *
 *   - `DEFAULT_PUBLIC_SITE_CONTENT` — safe fallbacks so public pages never
 *     render empty strings, "undefined", or error when CMS rows are missing.
 *   - `sanitizePublicSiteContent()` — server-side validation/coercion applied
 *     BEFORE anything is written to the database (length caps, URL checks,
 *     string coercion, no raw HTML/scripts).
 *   - `readPublicSiteContent()` — read-time accessor used by public pages.
 *
 * CMS controls content only — structure and design remain in code.
 */

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

export interface PublicAnnouncementContent {
  enabled: boolean;
  label: string;
  message: string;
  linkLabel: string;
  linkHref: string;
  startDate: string | null; // ISO date or null
  endDate: string | null; // ISO date or null
}

export interface PublicHeroContent {
  eyebrow: string;
  title: string;
  description: string;
  proofPoints: string[];
  primaryCtaLabel: string;
  primaryCtaHref: string;
  secondaryCtaLabel: string;
  secondaryCtaHref: string;
}

export interface PublicDemoContent {
  pageTitle: string;
  description: string;
  formIntro: string;
  successMessage: string;
  expectedResponse: string;
}

export interface PublicContactContent {
  salesEmail: string;
  supportEmail: string;
  phone: string;
  secondaryPhone: string;
  address: string;
  city: string;
  country: string;
  mapUrl: string;
  hours: string;
  intro: string;
}

export interface PublicFooterContent {
  description: string;
  copyrightText: string;
}

export interface PublicSeoContent {
  homepageTitle: string;
  homepageDescription: string;
  aboutTitle: string;
  aboutDescription: string;
  servicesTitle: string;
  servicesDescription: string;
  contactTitle: string;
  contactDescription: string;
  demoTitle: string;
  demoDescription: string;
  faqTitle: string;
  faqDescription: string;
  socialImageUrl: string;
}

export interface PublicSiteContentShape {
  announcement: PublicAnnouncementContent;
  hero: PublicHeroContent;
  demo: PublicDemoContent;
  contact: PublicContactContent;
  footer: PublicFooterContent;
  seo: PublicSeoContent;
}

/** Reserved key inside `cms_site_settings.metadata`. */
export const PUBLIC_SITE_CONTENT_KEY = 'publicSite';

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_PUBLIC_SITE_CONTENT: PublicSiteContentShape = {
  announcement: {
    enabled: false,
    label: '',
    message: '',
    linkLabel: '',
    linkHref: '',
    startDate: null,
    endDate: null,
  },
  hero: {
    eyebrow: 'Smarter fleet operations for Namibia',
    title: 'Smarter Fleet Operations. Stronger Accountability.',
    description:
      'Manage transport requests, approvals, vehicles, drivers, trips, fuel and maintenance from one system — with a complete digital audit trail.',
    proofPoints: [
      'End-to-end request to close workflow',
      'Role-based access and approvals',
      'Multi-tenant, configurable per organisation',
      'Offline-ready driver capture on mobile',
      'Immutable digital audit trail',
    ],
    primaryCtaLabel: 'Request a Demo',
    primaryCtaHref: '/request-demo',
    secondaryCtaLabel: 'See How It Works',
    secondaryCtaHref: '/#how-it-works',
  },
  demo: {
    pageTitle: 'Request a Demo',
    description:
      'See how GovFleet manages transport requests, approvals, vehicles, drivers, fuel and trip records in one accountable platform.',
    formIntro:
      'Tell us about your organisation and fleet operations. Our team will review your requirements and contact you using the details provided.',
    successMessage:
      'Demo request received. Our team will review your organisation’s requirements and contact you using the details provided.',
    expectedResponse:
      'A member of our team will contact you to schedule a short walkthrough tailored to your organisation.',
  },
  contact: {
    salesEmail: '',
    supportEmail: '',
    phone: '',
    secondaryPhone: '',
    address: '',
    city: '',
    country: '',
    mapUrl: '',
    hours: '',
    intro:
      'Questions about GovFleet for your organisation? Send us a message and our team will respond as soon as possible.',
  },
  footer: {
    description:
      'A digital fleet operations platform for government and public-sector organisations — managing requests, approvals, vehicles, drivers and trip records with full accountability.',
    copyrightText: '',
  },
  seo: {
    homepageTitle: 'GovFleet Namibia | Fleet Operations Platform',
    homepageDescription:
      'Manage transport requests, approvals, vehicles, drivers, trips, fuel and maintenance from one accountable digital platform for government and public-sector fleets.',
    aboutTitle: 'About | GovFleet Namibia',
    aboutDescription:
      'Why GovFleet exists — accountability, efficiency and operational visibility for government and public-sector fleet operations in Namibia.',
    servicesTitle: 'Platform & Services | GovFleet Namibia',
    servicesDescription:
      'Transport requests, approvals, vehicle allocation, inspections, fuel, compliance, maintenance, reports, mobile access and administration.',
    contactTitle: 'Contact | GovFleet Namibia',
    contactDescription:
      'Get in touch with the GovFleet team — request a demonstration or ask a question about the platform.',
    demoTitle: 'Request a Demo | GovFleet Namibia',
    demoDescription:
      'See how GovFleet manages transport requests, approvals, vehicles, drivers, fuel and trip records in one accountable platform.',
    faqTitle: 'FAQ | GovFleet Namibia',
    faqDescription:
      'Frequently asked questions about GovFleet — what it is, who can use it, and how to request a demonstration.',
    socialImageUrl: '',
  },
};

// ---------------------------------------------------------------------------
// Sanitisation helpers
// ---------------------------------------------------------------------------

const LIMITS = {
  short: 120,
  title: 200,
  description: 600,
  message: 2000,
  proofPoint: 100,
  maxProofPoints: 8,
};

function cleanString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  // Collapse control characters and strip anything that looks like markup.
  const collapsed = trimmed.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  return collapsed.length > max ? collapsed.slice(0, max) : collapsed;
}

function cleanUrl(value: unknown): string {
  const candidate = cleanString(value, LIMITS.short);
  if (!candidate) return '';
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {
    // fall through
  }
  // Allow internal paths such as /request-demo, /#how-it-works
  if (/^\/(?:#[\w-]+|\w[\w-]*)*(?:\/[\w-]*)*$/.test(candidate)) return candidate;
  return '';
}

function cleanBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === 'on' || value === 1;
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function cleanProofPoints(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const points: string[] = [];
  for (const item of value) {
    if (points.length >= LIMITS.maxProofPoints) break;
    const point = cleanString(item, LIMITS.proofPoint);
    if (point) points.push(point);
  }
  return points;
}

function cleanObjectField(
  source: unknown,
  key: string,
): Record<string, unknown> | null {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
  const value = (source as Record<string, unknown>)[key];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Sanitise (API write path)
// ---------------------------------------------------------------------------

/**
 * Validate + coerce untrusted JSON into the typed public-site shape.
 * Any field that is absent, invalid or too long is reset to its default —
 * so a broken payload can never corrupt the live site.
 */
export function sanitizePublicSiteContent(
  input: unknown,
): PublicSiteContentShape {
  const base = structuredClone(DEFAULT_PUBLIC_SITE_CONTENT);
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;

  const raw = input as Record<string, unknown>;

  const announcement = cleanObjectField(raw, 'announcement');
  if (announcement) {
    base.announcement.enabled = cleanBoolean(announcement.enabled);
    base.announcement.label = cleanString(announcement.label, LIMITS.short);
    base.announcement.message = cleanString(announcement.message, LIMITS.description);
    base.announcement.linkLabel = cleanString(announcement.linkLabel, LIMITS.short);
    base.announcement.linkHref = cleanUrl(announcement.linkHref);
    base.announcement.startDate = cleanDate(announcement.startDate);
    base.announcement.endDate = cleanDate(announcement.endDate);
  }

  const hero = cleanObjectField(raw, 'hero');
  if (hero) {
    base.hero.eyebrow = cleanString(hero.eyebrow, LIMITS.short);
    base.hero.title = cleanString(hero.title, LIMITS.title);
    base.hero.description = cleanString(hero.description, LIMITS.description);
    base.hero.proofPoints = cleanProofPoints(hero.proofPoints);
    base.hero.primaryCtaLabel = cleanString(hero.primaryCtaLabel, LIMITS.short);
    base.hero.primaryCtaHref = cleanUrl(hero.primaryCtaHref);
    base.hero.secondaryCtaLabel = cleanString(hero.secondaryCtaLabel, LIMITS.short);
    base.hero.secondaryCtaHref = cleanUrl(hero.secondaryCtaHref);
  }

  const demo = cleanObjectField(raw, 'demo');
  if (demo) {
    base.demo.pageTitle = cleanString(demo.pageTitle, LIMITS.title);
    base.demo.description = cleanString(demo.description, LIMITS.description);
    base.demo.formIntro = cleanString(demo.formIntro, LIMITS.description);
    base.demo.successMessage = cleanString(demo.successMessage, LIMITS.description);
    base.demo.expectedResponse = cleanString(demo.expectedResponse, LIMITS.description);
  }

  const contact = cleanObjectField(raw, 'contact');
  if (contact) {
    base.contact.salesEmail = cleanString(contact.salesEmail, LIMITS.short);
    base.contact.supportEmail = cleanString(contact.supportEmail, LIMITS.short);
    base.contact.phone = cleanString(contact.phone, LIMITS.short);
    base.contact.secondaryPhone = cleanString(contact.secondaryPhone, LIMITS.short);
    base.contact.address = cleanString(contact.address, LIMITS.title);
    base.contact.city = cleanString(contact.city, LIMITS.short);
    base.contact.country = cleanString(contact.country, LIMITS.short);
    base.contact.mapUrl = cleanUrl(contact.mapUrl);
    base.contact.hours = cleanString(contact.hours, LIMITS.short);
    base.contact.intro = cleanString(contact.intro, LIMITS.description);
  }

  const footer = cleanObjectField(raw, 'footer');
  if (footer) {
    base.footer.description = cleanString(footer.description, LIMITS.description);
    base.footer.copyrightText = cleanString(footer.copyrightText, LIMITS.title);
  }

  const seo = cleanObjectField(raw, 'seo');
  if (seo) {
    base.seo.homepageTitle = cleanString(seo.homepageTitle, LIMITS.title);
    base.seo.homepageDescription = cleanString(seo.homepageDescription, LIMITS.description);
    base.seo.aboutTitle = cleanString(seo.aboutTitle, LIMITS.title);
    base.seo.aboutDescription = cleanString(seo.aboutDescription, LIMITS.description);
    base.seo.servicesTitle = cleanString(seo.servicesTitle, LIMITS.title);
    base.seo.servicesDescription = cleanString(seo.servicesDescription, LIMITS.description);
    base.seo.contactTitle = cleanString(seo.contactTitle, LIMITS.title);
    base.seo.contactDescription = cleanString(seo.contactDescription, LIMITS.description);
    base.seo.demoTitle = cleanString(seo.demoTitle, LIMITS.title);
    base.seo.demoDescription = cleanString(seo.demoDescription, LIMITS.description);
    base.seo.faqTitle = cleanString(seo.faqTitle, LIMITS.title);
    base.seo.faqDescription = cleanString(seo.faqDescription, LIMITS.description);
    base.seo.socialImageUrl = cleanUrl(seo.socialImageUrl);
  }

  return base;
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

/**
 * Read the typed public-site content from a settings row, falling back to
 * defaults whenever the row or the stored shape is missing/partial.
 * Merges stored values over defaults so a partially-saved row still renders.
 */
export function readPublicSiteContent(
  settings: { metadata: Record<string, unknown> | null } | null,
): PublicSiteContentShape {
  const base = structuredClone(DEFAULT_PUBLIC_SITE_CONTENT);
  const stored = settings?.metadata?.[PUBLIC_SITE_CONTENT_KEY];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return base;

  // Re-sanitise stored values through the same pipeline for safety.
  const sanitised = sanitizePublicSiteContent(stored);

  const merge = <T extends object>(target: T, candidate: T | undefined): T => {
    if (!candidate) return target;
    return { ...target, ...candidate };
  };

  return {
    announcement: merge(base.announcement, sanitised.announcement),
    hero: merge(base.hero, sanitised.hero),
    demo: merge(base.demo, sanitised.demo),
    contact: merge(base.contact, sanitised.contact),
    footer: merge(base.footer, sanitised.footer),
    seo: merge(base.seo, sanitised.seo),
  } as PublicSiteContentShape;
}

/**
 * Convenience: read the stored public-site content from an existing settings
 * row for the admin editor (raw stored shape, defaults when empty).
 */
export function readStoredPublicSiteContent(
  settings: { metadata: Record<string, unknown> | null } | null,
): PublicSiteContentShape {
  if (!settings?.metadata) return structuredClone(DEFAULT_PUBLIC_SITE_CONTENT);
  const stored = settings.metadata[PUBLIC_SITE_CONTENT_KEY];
  return sanitizePublicSiteContent(stored);
}
