import { getDb } from '@/db';
import { shareLinks, generatedDocuments } from '@/db/schema/documents';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { APP_NAME } from '@/lib/constants';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';

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

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  transport_request: 'Transport Request',
  trip_authority: 'Trip Authority',
  vehicle_allocation: 'Vehicle Allocation',
  fuel_summary: 'Fuel Summary',
  inspection_report: 'Inspection Report',
  trip_completion: 'Trip Completion Report',
  maintenance_report: 'Maintenance Report',
  audit_report: 'Audit Report',
};

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const data = await resolveSharedDocument(token);

  if (!data) {
    notFound();
  }

  const brandColor = data.tenant.brandColor || '#2563eb';
  const docTypeLabel = DOCUMENT_TYPE_LABELS[data.documentType] || data.documentType;

  // Generate QR code for the verification URL
  let qrCodeDataUrl: string | null = null;
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const verificationUrl = `${baseUrl}/share/${token}`;
    qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
      width: 180,
      margin: 1,
      color: { dark: '#1F4E8C', light: '#FFFFFF' },
    });
  } catch {
    // QR generation failed silently
  }

  const verificationStatus = data.isRevoked
    ? { label: 'Revoked', color: 'text-status-error-text bg-status-error-bg border-status-error-border' }
    : data.isExpired
      ? { label: 'Expired', color: 'text-status-warning-text bg-status-warning-bg border-status-warning-border' }
      : { label: 'Active', color: 'text-status-success-text bg-status-success-bg border-status-success-border' };

  return (
    <div className="min-h-screen bg-page flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-surface shadow-sm mb-4">
            {data.tenant.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.tenant.logoUrl} alt="" className="w-10 h-10 object-contain" />
            ) : (
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-bold"
                style={{ backgroundColor: brandColor }}
              >
                {data.tenant.code.charAt(0)}
              </div>
            )}
          </div>
          <h1 className="text-xl font-semibold text-ink-950">
            {data.tenant.name}
          </h1>
          <p className="text-sm text-ink-500 mt-1">{APP_NAME}</p>
        </div>

        {/* Verification Card */}
        <div className="bg-surface rounded-2xl shadow-sm border border-border p-6 space-y-6">
          {/* Status Badge */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-ink-700">Document Verification</h2>
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${verificationStatus.color}`}
            >
              {verificationStatus.label}
            </span>
          </div>

          {/* Document Info */}
          <div className="space-y-3">
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-sm text-ink-500">Document Type</span>
              <span className="text-sm font-medium text-ink-950">{docTypeLabel}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-sm text-ink-500">Version</span>
              <span className="text-sm font-medium text-ink-950">v{data.documentVersion}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-sm text-ink-500">Status</span>
              <span className="text-sm font-medium text-ink-950 capitalize">{data.status}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-border">
              <span className="text-sm text-ink-500">Issued</span>
              <span className="text-sm font-medium text-ink-950">
                {new Date(data.createdAt).toLocaleDateString('en-NA', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
            {data.maxViews && (
              <div className="flex justify-between py-2 border-b border-gray-100">
                <span className="text-sm text-gray-500">Views</span>
                <span className="text-sm font-medium text-gray-900">
                  {data.currentViews} / {data.maxViews}
                </span>
              </div>
            )}
          </div>

          {/* Validity Period */}
          <div className="bg-gray-50 rounded-xl p-4">
            <p className="text-xs text-gray-500 mb-1">Validity</p>
            <p className="text-sm text-gray-700">
              Created {new Date(data.linkCreatedAt).toLocaleDateString('en-NA')}
              {' — '}
              Expires {new Date(data.expiresAt).toLocaleDateString('en-NA')}
            </p>
          </div>

          {/* Verification Seal */}
          <div className="text-center pt-2">
            <div className="inline-flex items-center gap-2 text-xs text-gray-400">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              <span>Digitally Verified — {APP_NAME}</span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-gray-400 mt-6">
          This verification page confirms the authenticity of a government fleet document.
          {data.status === 'superseded' && (
            <span className="block mt-1 text-amber-500">
              Note: This document has been superseded by a newer version.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
