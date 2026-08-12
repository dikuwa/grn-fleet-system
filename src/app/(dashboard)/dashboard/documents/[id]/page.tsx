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
  Clock,
  Database,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  History,
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
import { DocumentViewerActions } from './document-viewer-actions';
import { DocumentContent } from '@/components/documents/document-content';
import { TenantLogo } from '@/components/documents/tenant-logo';
import { resolveTenantBranding } from '@/lib/tenant-branding';
import { documentTypeLabel, formatDocumentStatus, formatHumanValue } from '@/lib/human-readable';

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

      {/* Document Preview Section — Download PDF / Preview / Print live here */}
      <Card>
        <CardHeader className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <CardTitle>Document Preview</CardTitle>
          <DocumentViewerActions
            documentId={doc.id}
            documentType={documentTypeLabel(doc.documentType)}
          />
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

      {/* Compact Document Metadata — supporting information, not the focus */}
      <Card>
        <CardHeader>
          <CardTitle>Document Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3 xl:grid-cols-4">
            <div>
              <dt className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
                Type
              </dt>
              <dd className="text-ink-950 mt-0.5 text-sm font-medium">
                {documentTypeLabel(doc.documentType)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
                Version
              </dt>
              <dd className="text-ink-950 mt-0.5 text-sm font-medium">{doc.documentVersion}</dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
                Template
              </dt>
              <dd className="text-ink-950 mt-0.5 text-sm font-medium">
                {doc.templateVersion || 'N/A'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
                Status
              </dt>
              <dd className="mt-0.5">
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
              </dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
                Redaction
              </dt>
              <dd className="text-ink-950 mt-0.5 text-sm font-medium">
                {formatHumanValue(doc.redactionProfile, 'redactionProfile')}
              </dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
                Generated by
              </dt>
              <dd className="text-ink-950 mt-0.5 text-sm font-medium">{creatorName}</dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
                Created
              </dt>
              <dd className="text-ink-950 mt-0.5 text-sm font-medium">
                {formatDateTime(doc.createdAt)}
              </dd>
            </div>
            {doc.hash && (
              <div className="col-span-2 md:col-span-3 xl:col-span-4">
                <dt className="text-ink-500 text-[11px] font-medium tracking-wider uppercase">
                  Document hash (SHA256)
                </dt>
                <dd className="text-ink-600 mt-0.5 truncate font-mono text-xs">{doc.hash}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

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
