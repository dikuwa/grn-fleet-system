import { getDb, isDbConnected } from '@/db';
import { generatedDocuments, shareLinks } from '@/db/schema/documents';
import { user } from '@/db/schema/better-auth';
import { eq, and, desc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FileText,
  Download,
  Clock,
  Database,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Link2,
  History,
  Eye,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getServerSession } from '@/lib/session';
import { createElement } from 'react';
import { DocumentLifecycleActions } from './lifecycle-actions';
import { CreateShareLinkButton } from './create-share-link';
import { ShareActions } from './share-actions';
import { QRDisplay } from './qr-display';
import { DocumentContent } from '@/components/documents/document-content';
import { TenantLogo } from '@/components/documents/tenant-logo';
import { resolveTenantBranding } from '@/lib/tenant-branding';
import { documentTypeLabel, formatDocumentStatus, formatHumanValue } from '@/lib/human-readable';
import { ShareLinkItem } from './share-link-item';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchDocumentDetail(id: string, tenantId: string) {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(and(eq(generatedDocuments.id, id), eq(generatedDocuments.tenantId, tenantId)))
    .limit(1);

  if (!doc) notFound();

  const shares = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.documentId, id))
    .orderBy(desc(shareLinks.createdAt));
  const [creator] = doc.generatedByUserId
    ? await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, doc.generatedByUserId))
        .limit(1)
    : [];

  return { doc, shares, creatorName: creator?.name || 'GovFleet' };
}

export default async function DocumentDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Documents', href: '/dashboard/documents' },
            { label: 'Document' },
          ]}
        />
        <PageHeader title="Document Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Documents', href: '/dashboard/documents' },
            { label: 'Document' },
          ]}
        />
        <PageHeader title="Document Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchDocumentDetail>>;
  try {
    data = await fetchDocumentDetail(id, session.tenantId);
  } catch (error) {
    console.error('Document detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Documents', href: '/dashboard/documents' },
            { label: 'Document' },
          ]}
        />
        <PageHeader title="Document Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Document" />
      </div>
    );
  }

  const { doc, shares, creatorName } = data;
  const branding = await resolveTenantBranding(session.tenantId);

  const statusIcon =
    doc.status === 'issued' ? CheckCircle2 : doc.status === 'draft' ? Clock : XCircle;
  const statusColor =
    doc.status === 'issued'
      ? 'text-status-success-text bg-status-success-bg'
      : doc.status === 'draft'
        ? 'text-status-pending-text bg-status-pending-bg'
        : 'text-status-cancelled-text bg-status-cancelled-bg';

  // Count active shares & build share URL
  const activeShares = shares.filter(
    (share) =>
      Boolean(share.shortSlug) && !share.isRevoked && new Date(share.expiresAt) > new Date(),
  );
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const shareUrl = activeShares[0]?.shortSlug ? `${baseUrl}/v/${activeShares[0].shortSlug}` : null;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Documents', href: '/dashboard/documents' },
          { label: documentTypeLabel(doc.documentType) },
        ]}
      />
      <PageHeader
        title={documentTypeLabel(doc.documentType)}
        description={`Version ${doc.documentVersion} · ${formatDate(doc.createdAt)}`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/documents">
            <ChevronLeft className="h-4 w-4" /> Back
          </Link>
        </Button>
        <Button variant="primary" size="sm" asChild>
          <a href={`/api/documents/${doc.id}/pdf`}>
            <Download className="h-4 w-4" /> Download PDF
          </a>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <a href={`/api/documents/${doc.id}/pdf?preview=1`} target="_blank" rel="noreferrer">
            <Eye className="h-4 w-4" /> Preview PDF
          </a>
        </Button>
        <DocumentLifecycleActions documentId={doc.id} currentStatus={doc.status} />
        <ShareActions
          shareUrl={shareUrl || undefined}
          documentTitle={documentTypeLabel(doc.documentType)}
          documentId={doc.id}
          documentReference={String(
            (doc.snapshotData as Record<string, unknown>).authorityNumber ||
              (doc.snapshotData as Record<string, unknown>).reference ||
              `Version ${doc.documentVersion}`,
          )}
          status={formatDocumentStatus(doc.status)}
          organisationName={branding?.organisationName}
          verificationCode={activeShares[0]?.verificationCode || undefined}
        />
        <CreateShareLinkButton documentId={doc.id} disabled={doc.status === 'draft'} />
      </PageHeader>

      {/* Status Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] ${statusColor}`}
            >
              {createElement(statusIcon, { className: 'h-7 w-7' })}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-ink-950 text-lg font-semibold">
                  {documentTypeLabel(doc.documentType)}
                </h2>
                <Badge
                  variant={
                    doc.status === 'issued'
                      ? 'success'
                      : doc.status === 'draft'
                        ? 'pending'
                        : 'cancelled'
                  }
                  size="sm"
                >
                  {formatDocumentStatus(doc.status)}
                </Badge>
                <Badge variant="info" size="sm">
                  v{doc.documentVersion}
                </Badge>
              </div>
              <div className="text-ink-500 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>Template: {doc.templateVersion || 'N/A'}</span>
                <span>Redaction: {doc.redactionProfile || 'internal'}</span>
                <span>Created: {formatDateTime(doc.createdAt)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Document Preview Section */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Document Preview</CardTitle>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm">
              <Download className="h-4 w-4" /> PDF
            </Button>
            <Button variant="secondary" size="sm">
              <Eye className="h-4 w-4" /> Preview
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border-border bg-muted/30 overflow-auto rounded-[10px] border p-3 sm:p-6">
            <div className="mx-auto aspect-[210/297] min-h-[500px] w-full max-w-[210mm] overflow-y-auto rounded-[4px] bg-white p-[7mm] font-[Onest] text-slate-900 shadow-sm sm:p-[12mm]">
              {/* Document Header */}
              <div className="relative mb-4 border-b border-[#1F2A44] pb-3">
                {doc.status === 'draft' && (
                  <span className="pointer-events-none absolute inset-0 flex rotate-[-20deg] items-center justify-center text-5xl font-bold text-slate-200">
                    DRAFT
                  </span>
                )}
                <div className="relative flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <TenantLogo
                      src={branding?.logoUrl}
                      organisationName={branding?.organisationName || 'Government Fleet'}
                      code={branding?.code}
                      className="h-12 w-12"
                    />
                    <div>
                      <p className="text-xs font-bold text-[#1F2A44]">
                        {branding?.organisationName || 'Government Fleet'}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        {branding?.division || 'Fleet Management'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-base font-bold text-[#1F2A44]">
                      {documentTypeLabel(doc.documentType).toUpperCase()}
                    </p>
                    <p className="text-[10px] text-slate-500">
                      Version {doc.documentVersion} · {formatDocumentStatus(doc.status)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Snapshot Data */}
              {doc.snapshotData && Object.keys(doc.snapshotData).length > 0 ? (
                <DocumentContent
                  documentType={doc.documentType}
                  data={doc.snapshotData as Record<string, unknown>}
                />
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="text-ink-300 mb-2 h-8 w-8" />
                  <p className="text-ink-500 text-sm">Document content snapshot not available</p>
                  <p className="text-ink-400 mt-1 text-xs">
                    The document will render after generation.
                  </p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metadata Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Document Metadata</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="border-border/50 flex justify-between border-b pb-2">
              <span className="text-ink-500">Type</span>
              <span className="text-ink-950 font-medium">
                {documentTypeLabel(doc.documentType)}
              </span>
            </div>
            <div className="border-border/50 flex justify-between border-b pb-2">
              <span className="text-ink-500">Version</span>
              <span className="text-ink-950 font-medium">{doc.documentVersion}</span>
            </div>
            <div className="border-border/50 flex justify-between border-b pb-2">
              <span className="text-ink-500">Template Version</span>
              <span className="text-ink-950 font-medium">{doc.templateVersion || 'N/A'}</span>
            </div>
            <div className="border-border/50 flex justify-between border-b pb-2">
              <span className="text-ink-500">Status</span>
              <span className="font-medium">
                <Badge
                  variant={
                    doc.status === 'issued'
                      ? 'success'
                      : doc.status === 'draft'
                        ? 'pending'
                        : 'cancelled'
                  }
                  size="sm"
                >
                  {formatDocumentStatus(doc.status)}
                </Badge>
              </span>
            </div>
            <div className="border-border/50 flex justify-between border-b pb-2">
              <span className="text-ink-500">Redaction Profile</span>
              <span className="text-ink-950 font-medium">
                {formatHumanValue(doc.redactionProfile, 'redactionProfile')}
              </span>
            </div>
            {doc.hash && (
              <div className="border-border/50 flex justify-between border-b pb-2">
                <span className="text-ink-500">Hash</span>
                <span className="text-ink-600 max-w-[200px] truncate font-mono text-xs">
                  {doc.hash}
                </span>
              </div>
            )}
            <div className="border-border/50 flex justify-between border-b pb-2">
              <span className="text-ink-500">Generated By</span>
              <span className="text-ink-950 font-medium">{creatorName}</span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-ink-500">Created</span>
              <span className="text-ink-950 font-medium">{formatDateTime(doc.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Secure Sharing</CardTitle>
            <CreateShareLinkButton documentId={doc.id} disabled={doc.status === 'draft'} />
          </CardHeader>
          <CardContent className="space-y-4">
            {activeShares.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Link2 className="text-ink-300 mb-2 h-8 w-8" />
                <p className="text-ink-500 text-sm">No active share links</p>
                <p className="text-ink-400 mt-1 text-xs">
                  Create a secure share link to share this document externally.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeShares.map((share) => (
                  <ShareLinkItem
                    key={share.id}
                    id={share.id}
                    shareUrl={`${baseUrl}/v/${share.shortSlug}`}
                    expiresAt={share.expiresAt}
                    currentViews={share.currentViews}
                    maxViews={share.maxViews}
                    lastAccessedAt={share.lastAccessedAt}
                    verificationCode={share.verificationCode}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* QR Code */}
      <QRDisplay shareUrl={shareUrl} documentTitle={doc.documentType} />

      {/* Version History */}
      {doc.documentVersion > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Version History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border-border flex items-center gap-3 rounded-[8px] border p-4">
              <History className="text-ink-400 h-5 w-5" />
              <div>
                <p className="text-ink-950 text-sm font-medium">Version {doc.documentVersion}</p>
                <p className="text-ink-500 text-xs">
                  Current version. Prior versions are available in the document history.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
