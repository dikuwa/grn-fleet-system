import { getDb } from '@/db';
import { shareLinks, generatedDocuments } from '@/db/schema/documents';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { APP_NAME } from '@/lib/constants';
import { createHash } from 'node:crypto';
import { PublicThemeToggle } from '@/components/layout/public-theme-toggle';
import { TenantLogo } from '@/components/documents/tenant-logo';
import { documentTypeLabel, formatDocumentStatus } from '@/lib/human-readable';

interface PageProps {
  params: Promise<{ token: string }>;
}

async function resolveSharedDocument(token: string) {
  const db = getDb();

  // Hash the token to find the share link (Node.js crypto for server-side)
  const tokenHash = createHash('sha256')
    .update(token)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const [link] = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.tokenHash, tokenHash))
    .limit(1);

  if (!link) return null;

  // Fetch the document
  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, link.documentId))
    .limit(1);

  if (!doc) return null;

  // Fetch tenant + branding info
  const [tenant] = await db
    .select({
      name: tenants.name,
      code: tenants.code,
      logoUrl: tenantBranding.logoUrl,
      brandColor: tenantBranding.primaryColor,
    })
    .from(tenants)
    .leftJoin(tenantBranding, eq(tenantBranding.tenantId, tenants.id))
    .where(eq(tenants.id, doc.tenantId))
    .limit(1);

  const isExpired = new Date(link.expiresAt) < new Date();
  const isRevoked = link.isRevoked;

  return {
    documentType: doc.documentType,
    documentVersion: doc.documentVersion,
    status: doc.status,
    createdAt: doc.createdAt.toISOString(),
    linkCreatedAt: link.createdAt.toISOString(),
    expiresAt: link.expiresAt.toISOString(),
    isExpired,
    isRevoked,
    currentViews: link.currentViews,
    maxViews: link.maxViews,
    tenant: tenant || { name: 'Unknown', code: '', logoUrl: null, brandColor: null },
  };
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const data = await resolveSharedDocument(token);

  if (!data) {
    notFound();
  }

  const docTypeLabel = documentTypeLabel(data.documentType);

  const verificationStatus = data.isRevoked
    ? {
        label: 'Revoked',
        color: 'text-status-error-text bg-status-error-bg border-status-error-border',
      }
    : data.isExpired
      ? {
          label: 'Expired',
          color: 'text-status-pending-text bg-status-pending-bg border-status-pending-bg',
        }
      : data.status === 'draft'
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
        {/* Header */}
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

        {/* Verification Card */}
        <div className="bg-surface border-border space-y-6 rounded-2xl border p-6 shadow-sm">
          {/* Status Badge */}
          <div className="flex items-center justify-between">
            <h2 className="text-ink-700 text-sm font-medium">Document Verification</h2>
            <span
              className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${verificationStatus.color}`}
            >
              {verificationStatus.label}
            </span>
          </div>

          {/* Document Info */}
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

          {/* Validity Period */}
          <div className="bg-muted rounded-xl p-4">
            <p className="text-ink-500 mb-1 text-xs">Validity</p>
            <p className="text-ink-700 text-sm">
              Created {new Date(data.linkCreatedAt).toLocaleDateString('en-NA')}
              {' — '}
              Expires {new Date(data.expiresAt).toLocaleDateString('en-NA')}
            </p>
          </div>

          {/* Verification Seal */}
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

        {/* Footer */}
        <p className="text-ink-500 mt-6 text-center text-xs">
          This verification page confirms the authenticity of a government fleet document.
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
