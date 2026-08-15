import { getDb } from '@/db';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { notFound, redirect } from 'next/navigation';
import { APP_NAME } from '@/lib/constants';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { TenantLogo } from '@/components/documents/tenant-logo';
import { documentTypeLabel, formatDocumentStatus } from '@/lib/human-readable';
import { resolveSharedDocument, verifyShareToken } from '@/lib/share-token';

interface PageProps {
  params: Promise<{ token: string }>;
}

async function resolveLegacySharedDocument(token: string) {
  const verification = await verifyShareToken(token);
  if (!verification.valid || !verification.shareLink) return null;

  // Modern records use the compact verification route. Redirect before claiming
  // a view here so /v/:slug remains the single access counter and disclosure
  // boundary rather than charging one visit twice.
  if (verification.shareLink.shortSlug) {
    redirect(`/v/${encodeURIComponent(verification.shareLink.shortSlug)}`);
  }

  // Very old rows without short_slug remain backwards compatible, but access is
  // now claimed through the same atomic expiry/revocation/max-view service.
  const resolved = await resolveSharedDocument(token);
  if (!resolved.document) return null;

  const doc = resolved.document;
  const link = verification.shareLink;
  const db = getDb();
  const [tenant] = await db
    .select({
      name: tenants.name,
      code: tenants.code,
      logoUrl: tenantBranding.logoUrl,
    })
    .from(tenants)
    .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
    .where(eq(tenants.id, doc.tenantId))
    .limit(1);

  const snapshot = doc.snapshotData as Record<string, unknown>;
  const identity = snapshot.documentIdentity as
    | { organisationName?: string; logoUrl?: string }
    | undefined;
  const brandingMeta = snapshot.brandingMeta as
    | { organisationName?: string; code?: string }
    | undefined;

  return {
    documentType: doc.documentType,
    documentVersion: doc.documentVersion,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    linkCreatedAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    currentViews: link.currentViews + 1,
    maxViews: link.maxViews,
    tenant: {
      name:
        brandingMeta?.organisationName ||
        identity?.organisationName ||
        tenant?.name ||
        'Government Fleet',
      code: brandingMeta?.code || tenant?.code || '',
      logoUrl: identity?.logoUrl || tenant?.logoUrl || null,
    },
  };
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const data = await resolveLegacySharedDocument(token);

  if (!data) notFound();

  const docTypeLabel = documentTypeLabel(data.documentType);
  const verificationStatus = data.status === 'draft'
    ? {
        label: 'Draft — not issued',
        color: 'text-status-pending-text bg-status-pending-bg border-status-pending-bg',
      }
    : data.status === 'superseded'
      ? {
          label: 'Superseded',
          color: 'text-status-pending-text bg-status-pending-bg border-status-pending-bg',
        }
      : {
          label: 'Verified and active',
          color: 'text-status-success-text bg-status-success-bg border-status-success-border',
        };

  return (
    <div className="bg-canvas relative flex min-h-screen items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <PublicThemeToggle />
      </div>
      <div className="w-full max-w-lg">
        <div className="mb-8 text-center">
          <div className="bg-surface mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full shadow-sm">
            <TenantLogo
              src={data.tenant.logoUrl}
              organisationName={data.tenant.name}
              code={data.tenant.code}
              className="h-10 w-10"
            />
          </div>
          <h1 className="text-ink-950 text-xl font-semibold">{data.tenant.name}</h1>
          <p className="text-ink-500 mt-1 text-sm">{APP_NAME}</p>
        </div>

        <div className="bg-surface border-border space-y-6 rounded-2xl border p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-ink-700 text-sm font-medium">Document Verification</h2>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${verificationStatus.color}`}
            >
              {verificationStatus.label}
            </span>
          </div>

          <div className="space-y-3">
            <div className="border-border flex justify-between border-b py-2">
              <span className="text-ink-500 text-sm">Document Type</span>
              <span className="text-ink-950 text-sm font-medium">{docTypeLabel}</span>
            </div>
            <div className="border-border flex justify-between border-b py-2">
              <span className="text-ink-500 text-sm">Version</span>
              <span className="text-ink-950 text-sm font-medium">v{data.documentVersion}</span>
            </div>
            <div className="border-border flex justify-between border-b py-2">
              <span className="text-ink-500 text-sm">Status</span>
              <span className="text-ink-950 text-sm font-medium">
                {formatDocumentStatus(data.status)}
              </span>
            </div>
            <div className="border-border flex justify-between border-b py-2">
              <span className="text-ink-500 text-sm">Issued</span>
              <span className="text-ink-950 text-sm font-medium">
                {new Date(data.createdAt).toLocaleDateString('en-NA', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
            {data.maxViews && (
              <div className="border-border flex justify-between border-b py-2">
                <span className="text-ink-500 text-sm">Views</span>
                <span className="text-ink-950 text-sm font-medium">
                  {data.currentViews} / {data.maxViews}
                </span>
              </div>
            )}
          </div>

          <div className="bg-muted rounded-xl p-4">
            <p className="text-ink-500 mb-1 text-xs">Validity</p>
            <p className="text-ink-700 text-sm">
              Created {new Date(data.linkCreatedAt).toLocaleDateString('en-NA')}
              {' — '}
              Expires {new Date(data.expiresAt).toLocaleDateString('en-NA')}
            </p>
          </div>

          <div className="pt-2 text-center">
            <div className="text-ink-500 inline-flex items-center gap-2 text-xs">
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              <span>Digitally Verified — {APP_NAME}</span>
            </div>
          </div>
        </div>

        <p className="text-ink-500 mt-6 text-center text-xs">
          This legacy verification page confirms authenticity only and does not disclose the document body.
          {data.status === 'superseded' && (
            <span className="mt-1 block text-amber-500">
              Note: This document has been superseded by a newer version.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
