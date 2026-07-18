/**
 * Public Share View
 *
 * Resolves a secure share token and displays the shared document to
 * external viewers. This page is intentionally minimal — no dashboard,
 * no navigation, just the document content and metadata.
 *
 * Route: /share/[token]
 *
 * Access control is handled entirely by the share token: validity,
 * expiry, revocation, and view limits are checked server-side before
 * any content is rendered.
 */

import { notFound } from 'next/navigation';
import { verifyShareToken } from '@/lib/share-token';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { tenants } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { formatDate, formatDateTime } from '@/lib/utils';
import { createElement } from 'react';
import { FileText, Clock, CheckCircle2, XCircle, AlertTriangle, Shield } from 'lucide-react';

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function SharedDocumentPage({ params }: PageProps) {
  const { token } = await params;

  if (!token) notFound();

  const verification = await verifyShareToken(token);

  if (!verification.valid) {
    const errorMessages: Record<string, { title: string; description: string; icon: 'expired' | 'revoked' | 'not_found' | 'limit' }> = {
      not_found: {
        title: 'Document Not Found',
        description: 'This share link could not be found. It may have been removed or the link may be incorrect.',
        icon: 'not_found',
      },
      revoked: {
        title: 'Share Link Revoked',
        description: 'This share link has been revoked by the document owner. Please request a new link.',
        icon: 'revoked',
      },
      expired: {
        title: 'Share Link Expired',
        description: 'This share link has expired. Please request a new link from the document owner.',
        icon: 'expired',
      },
      max_views_exceeded: {
        title: 'View Limit Reached',
        description: 'This share link has reached its maximum number of views. Please request a new link.',
        icon: 'limit',
      },
      verification_error: {
        title: 'Verification Error',
        description: 'The share link could not be verified. Please try again or request a new link.',
        icon: 'not_found',
      },
    };

    const error = errorMessages[verification.reason || 'not_found'] || errorMessages.not_found;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
        <div className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
            {error.icon === 'expired' ? (
              <Clock className="h-8 w-8 text-red-500" />
            ) : error.icon === 'revoked' ? (
              <XCircle className="h-8 w-8 text-red-500" />
            ) : (
              <AlertTriangle className="h-8 w-8 text-red-500" />
            )}
          </div>
          <h1 className="text-xl font-bold text-gray-900">{error.title}</h1>
          <p className="mt-2 text-sm text-gray-500">{error.description}</p>

          {verification.shareLink && (
            <div className="mt-4 rounded-lg bg-gray-50 p-3 text-left text-xs text-gray-500">
              <p>Document ID: {verification.shareLink.documentId.slice(0, 8)}…</p>
              <p>Created: {formatDate(verification.shareLink.createdAt)}</p>
              {verification.shareLink.expiresAt && (
                <p>Expires: {formatDate(verification.shareLink.expiresAt)}</p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Resolve the actual document
  const db = getDb();
  const shareLink = verification.shareLink!;

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, shareLink.documentId))
    .limit(1);

  if (!doc) notFound();

  // Look up tenant name for branding
  const [tenant] = await db
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, doc.tenantId))
    .limit(1);

  const statusIcon = doc.status === 'issued' ? CheckCircle2 :
    doc.status === 'draft' ? Clock : XCircle;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-gray-600" />
            <span className="text-sm font-medium text-gray-900">
              {tenant?.name || 'Government Fleet Management'}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <Shield className="h-3.5 w-3.5" />
            <span>Securely shared document</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-4xl px-4 py-8">
        {/* Title Card */}
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {doc.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Version {doc.documentVersion} · {formatDate(doc.createdAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ${
                doc.status === 'issued' ? 'bg-green-50 text-green-700' :
                doc.status === 'draft' ? 'bg-amber-50 text-amber-700' :
                'bg-red-50 text-red-700'
              }`}>
                {createElement(statusIcon, { className: 'h-3.5 w-3.5' })}
                {doc.status}
              </span>
            </div>
          </div>
        </div>

        {/* Document Content */}
        <div className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="mx-auto max-w-[210mm] min-h-[297mm]">
            {/* Document Header */}
            <div className="mb-6 border-b border-gray-300 pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-500">{tenant?.name || 'Government Fleet'}</p>
                  <p className="text-lg font-bold text-gray-900">
                    {doc.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                  </p>
                </div>
                <span className="rounded-md bg-gray-100 px-2 py-1 text-xs font-mono text-gray-500">
                  v{doc.documentVersion}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Reference: {doc.id.slice(0, 8)} · Generated {formatDateTime(doc.createdAt)}
              </p>
            </div>

            {/* Snapshot Data */}
            {doc.snapshotData && Object.keys(doc.snapshotData).length > 0 ? (
              <div className="space-y-3 text-sm">
                {Object.entries(doc.snapshotData).map(([key, value]) => (
                  <div key={key} className="flex border-b border-gray-100 py-2">
                    <span className="w-1/3 font-medium text-gray-600 text-xs uppercase tracking-wider">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="w-2/3 text-gray-900">
                      {typeof value === 'object' && value !== null
                        ? JSON.stringify(value, null, 2)
                        : String(value ?? 'N/A')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <FileText className="h-12 w-12 text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">Document content is not available</p>
                <p className="text-xs text-gray-400 mt-1">The snapshot data for this document could not be loaded.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center text-xs text-gray-400">
          <p>This document was shared securely via the Government Fleet Management System.</p>
          <p className="mt-1">© {new Date().getFullYear()} {tenant?.name || 'Government Fleet Management'}. All rights reserved.</p>
        </div>
      </main>
    </div>
  );
}
