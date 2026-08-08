/**
 * Public website layout.
 *
 * Wraps every public route with the shared PublicHeader and PublicFooter.
 * Site settings (name, logo, tagline, contact details) are loaded once from
 * CMS here and passed down — public pages no longer duplicate header/footer
 * markup, and content stays editable by Platform Admin.
 */

import { PublicHeader } from '@/components/public/public-header';
import { PublicFooter } from '@/components/public/public-footer';
import { AnnouncementBar } from '@/components/public/announcement-bar';
import { getPublicSiteSettings } from '@/lib/platform/cms-public';
import { readPublicSiteContent } from '@/lib/platform/site-settings-content';

// Public pages are fully CMS-driven (hero, announcement, contact, footer,
// SEO). Render them on demand so Platform Admin edits take effect immediately
// instead of serving build-time snapshots from the prerender cache.
export const dynamic = 'force-dynamic';

export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let settings: Awaited<ReturnType<typeof getPublicSiteSettings>> = null;
  try {
    settings = await getPublicSiteSettings();
  } catch {
    // CMS unreachable — header/footer fall back to safe defaults.
  }

  const publicContent = readPublicSiteContent(settings);

  return (
    <div className="flex min-h-screen flex-col">
      <AnnouncementBar announcement={publicContent.announcement} />
      <PublicHeader
        siteName={settings?.siteName ?? undefined}
        logoUrl={settings?.logoUrl ?? null}
      />
      <main className="flex-1">{children}</main>
      <PublicFooter
        siteName={settings?.siteName ?? undefined}
        siteTagline={settings?.siteTagline ?? null}
        description={publicContent.footer.description}
        copyrightText={publicContent.footer.copyrightText}
        contactEmail={settings?.contactEmail ?? null}
        contactPhone={settings?.contactPhone ?? null}
        address={settings?.address ?? null}
      />
    </div>
  );
}
