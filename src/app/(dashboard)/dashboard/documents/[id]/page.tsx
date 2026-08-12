import { getDb, isDbConnected } from '@/db';
import { generatedDocuments, shareLinks } from '@/db/schema/documents';
import { user } from '@/db/schema/better-auth';
import { eq, and, desc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Clock, Database, ChevronLeft, CheckCircle2, XCircle, History } from 'lucide-react';
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
  const statusIcon = doc.status === 'issued' ? CheckCircle2 : doc.status === 'draft' ? Clock : XCircle;
  const statusColor =
    doc.status === 'issued'
      ? 'text-status-success-text bg-status-success-bg'
      : doc.status === 'draft'
        ? 'text-status-pending-text bg-status-pending-bg'
        : 'text-status-cancelled-text bg-status-cancelled-bg';

  const activeShares = shares.filter(
    (share) => Boolean(share.shortSlug) && !share.isRevoked && new Date(share.expiresAt) > new Date(),
  );
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const shareUrl = activeShares[0]?.shortSlug ? `${baseUrl}/v/${activeShares[0].shortSlug}` : null;
  const pdfPreviewUrl = `/api/documents/${doc.id}/pdf?preview=1`;

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

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] ${statusColor}`}>
              {createElement(statusIcon, { className: 'h-7 w-7' })}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-ink-950 text-lg font-semibold">{documentTypeLabel(doc.documentType)}</h2>
                <Badge
                  variant={doc.status === 'issued' ? 'success' : doc.status === 'draft' ? 'pending' : 'cancelled'}
                  size="sm"
                >
                  {formatDocumentStatus(doc.status)}
                </Badge>
                <Badge variant="info" size="sm">v{doc.documentVersion}</Badge>
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

      <Card>
        <CardHeader className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <CardTitle>Document Preview</CardTitle>
            <p className="text-ink-500 mt-1 text-xs">This is the same document used for Preview, Print and Download PDF.</p>
          </div>
          <DocumentViewerActions documentId={doc.id} documentType={documentTypeLabel(doc.documentType)} />
        </CardHeader>
        <CardContent>
          <div className="border-border bg-muted/30 overflow-hidden rounded-[10px] border p-2 sm:p-4">
            <div className="mx-auto aspect-[210/297] min-h-[620px] w-full max-w-[210mm] overflow-hidden rounded-[4px] bg-white shadow-sm">
              <iframe
                src={pdfPreviewUrl}
                title={`${documentTypeLabel(doc.documentType)} printable preview`}
                className="h-full min-h-[620px] w-full border-0 bg-white"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Document Metadata</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4 xl:grid-cols-7">
            <div>
              <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Type</dt>
              <dd className="text-ink-950 mt-0.5 text-xs font-medium">{documentTypeLabel(doc.documentType)}</dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Version</dt>
              <dd className="text-ink-950 mt-0.5 text-xs font-medium">{doc.documentVersion}</dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Template</dt>
              <dd className="text-ink-950 mt-0.5 text-xs font-medium">{doc.templateVersion || 'N/A'}</dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Status</dt>
              <dd className="mt-0.5">
                <Badge variant={doc.status === 'issued' ? 'success' : doc.status === 'draft' ? 'pending' : 'cancelled'} size="sm">
                  {formatDocumentStatus(doc.status)}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Redaction</dt>
              <dd className="text-ink-950 mt-0.5 text-xs font-medium">{formatHumanValue(doc.redactionProfile, 'redactionProfile')}</dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Generated by</dt>
              <dd className="text-ink-950 mt-0.5 text-xs font-medium">{creatorName}</dd>
            </div>
            <div>
              <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Created</dt>
              <dd className="text-ink-950 mt-0.5 text-xs font-medium">{formatDateTime(doc.createdAt)}</dd>
            </div>
            {doc.hash && (
              <div className="col-span-2 md:col-span-4 xl:col-span-7">
                <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Document hash (SHA256)</dt>
                <dd className="text-ink-600 mt-0.5 break-all font-mono text-[10px]">{doc.hash}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <QRDisplay shareUrl={shareUrl} documentTitle={doc.documentType} />

      {doc.documentVersion > 1 && (
        <Card>
          <CardHeader><CardTitle>Version History</CardTitle></CardHeader>
          <CardContent>
            <div className="border-border flex items-center gap-3 rounded-[8px] border p-4">
              <History className="text-ink-400 h-5 w-5" />
              <div>
                <p className="text-ink-950 text-sm font-medium">Version {doc.documentVersion}</p>
                <p className="text-ink-500 text-xs">Current version. Prior versions are available in the document history.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
