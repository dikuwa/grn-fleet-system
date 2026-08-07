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
import { getPublicSiteSettings } from '@/lib/platform/cms-public';

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

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader
        siteName={settings?.siteName ?? undefined}
        logoUrl={settings?.logoUrl ?? null}
      />
      <main className="flex-1">{children}</main>
      <PublicFooter
        siteName={settings?.siteName ?? undefined}
        siteTagline={settings?.siteTagline ?? null}
        contactEmail={settings?.contactEmail ?? null}
        contactPhone={settings?.contactPhone ?? null}
        address={settings?.address ?? null}
      />
    </div>
  );
}
