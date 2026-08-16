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
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { createElement } from 'react';
import { DocumentLifecycleActions } from './lifecycle-actions';
import { CreateShareLinkButton } from './create-share-link';
import { ShareActions } from './share-actions';
import { DocumentViewerActions } from './document-viewer-actions';
import { DocumentPdfPreview } from './document-pdf-preview';
import { resolveTenantBranding } from '@/lib/tenant-branding';
import { abbreviatedDocumentHash } from '@/lib/document-verification';
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

  const [shares, versions, creatorRows] = await Promise.all([
    db
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.documentId, id), eq(shareLinks.tenantId, tenantId)))
      .orderBy(desc(shareLinks.createdAt)),
    db
      .select({
        id: generatedDocuments.id,
        documentVersion: generatedDocuments.documentVersion,
        status: generatedDocuments.status,
        hash: generatedDocuments.hash,
        createdAt: generatedDocuments.createdAt,
      })
      .from(generatedDocuments)
      .where(
        and(
          eq(generatedDocuments.tenantId, tenantId),
          eq(generatedDocuments.entityType, doc.entityType),
          eq(generatedDocuments.entityId, doc.entityId),
          eq(generatedDocuments.documentType, doc.documentType),
        ),
      )
      .orderBy(desc(generatedDocuments.documentVersion)),
    doc.generatedByUserId
      ? db
          .select({ name: user.name })
          .from(user)
          .where(eq(user.id, doc.generatedByUserId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    doc,
    shares,
    versions,
    creatorName: creatorRows[0]?.name || 'GovFleet',
  };
}

export default async function DocumentDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Documents', href: '/dashboard/documents' }, { label: 'Document' }]} />
        <PageHeader title="Document Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Documents', href: '/dashboard/documents' }, { label: 'Document' }]} />
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
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Documents', href: '/dashboard/documents' }, { label: 'Document' }]} />
        <PageHeader title="Document Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Document" />
      </div>
    );
  }

  const { doc, shares, versions, creatorName } = data;
  const [branding, roleNames] = await Promise.all([
    resolveTenantBranding(session.tenantId),
    getSessionRoleNames(session),
  ]);
  const documentAccess = resolveDashboardAccess('/dashboard/documents', roleNames);
  const shareLinkAccess = resolveDashboardAccess('/dashboard/share-links', roleNames);
  const canManageLifecycle = documentAccess.allowed && documentAccess.actions.includes('update');
  const canCreateShareLink = shareLinkAccess.allowed && shareLinkAccess.actions.includes('create');
  const snapshot = (doc.snapshotData || {}) as Record<string, unknown>;

  const statusIcon = doc.status === 'issued' ? CheckCircle2 : doc.status === 'draft' ? Clock : XCircle;
  const statusColor = doc.status === 'issued'
    ? 'text-status-success-text bg-status-success-bg'
    : doc.status === 'draft'
      ? 'text-status-pending-text bg-status-pending-bg'
      : 'text-status-cancelled-text bg-status-cancelled-bg';

  const activeShares = shares.filter(
    (share) => Boolean(share.shortSlug) && !share.isRevoked && new Date(share.expiresAt) > new Date(),
  );
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const verificationUrl = doc.verificationSlug
    ? `${baseUrl}/v/${doc.verificationSlug}`
    : activeShares[0]?.shortSlug
      ? `${baseUrl}/v/${activeShares[0].shortSlug}`
      : null;
  const verificationCode = doc.verificationCode || activeShares[0]?.verificationCode || undefined;
  const pdfPreviewUrl = `/api/documents/${doc.id}/pdf?preview=1`;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Documents', href: '/dashboard/documents' }, { label: documentTypeLabel(doc.documentType) }]} />
      <PageHeader title={documentTypeLabel(doc.documentType)} description={`Version ${doc.documentVersion} · ${formatDate(doc.createdAt)}`}>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/documents"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
        {canManageLifecycle && (
          <DocumentLifecycleActions documentId={doc.id} currentStatus={doc.status} />
        )}
        <ShareActions
          shareUrl={verificationUrl || undefined}
          documentTitle={documentTypeLabel(doc.documentType)}
          documentId={doc.id}
          documentReference={String(snapshot.authorityNumber || snapshot.reference || snapshot.requestReference || `Version ${doc.documentVersion}`)}
          status={formatDocumentStatus(doc.status)}
          organisationName={branding?.organisationName}
          verificationCode={verificationCode}
        />
        {canCreateShareLink && (
          <CreateShareLinkButton documentId={doc.id} disabled={doc.status !== 'issued'} />
        )}
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
                <Badge variant={doc.status === 'issued' ? 'success' : doc.status === 'draft' ? 'pending' : 'cancelled'} size="sm">{formatDocumentStatus(doc.status)}</Badge>
                <Badge variant="info" size="sm">v{doc.documentVersion}</Badge>
              </div>
              <div className="text-ink-500 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>Template: {doc.templateVersion || 'Not recorded'}</span>
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
            <p className="text-ink-500 mt-1 text-xs">Secure in-app preview. Preview, Print and Download use the same official PDF.</p>
          </div>
          <DocumentViewerActions documentId={doc.id} documentType={documentTypeLabel(doc.documentType)} />
        </CardHeader>
        <CardContent>
          <div className="border-border h-[clamp(640px,76vh,980px)] min-h-0 w-full overflow-hidden rounded-[10px] border">
            <DocumentPdfPreview url={pdfPreviewUrl} title={`${documentTypeLabel(doc.documentType)} printable preview`} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle>Document Metadata</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4 xl:grid-cols-7">
            <div><dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Type</dt><dd className="text-ink-950 mt-0.5 text-xs font-medium">{documentTypeLabel(doc.documentType)}</dd></div>
            <div><dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Version</dt><dd className="text-ink-950 mt-0.5 text-xs font-medium">{doc.documentVersion}</dd></div>
            <div><dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Verification</dt><dd className="text-ink-950 mt-0.5 font-mono text-xs font-medium">{verificationCode || 'Not issued'}</dd></div>
            <div><dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Status</dt><dd className="mt-0.5"><Badge variant={doc.status === 'issued' ? 'success' : doc.status === 'draft' ? 'pending' : 'cancelled'} size="sm">{formatDocumentStatus(doc.status)}</Badge></dd></div>
            <div><dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Redaction</dt><dd className="text-ink-950 mt-0.5 text-xs font-medium">{formatHumanValue(doc.redactionProfile, 'redactionProfile')}</dd></div>
            <div><dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Generated by</dt><dd className="text-ink-950 mt-0.5 text-xs font-medium">{creatorName}</dd></div>
            <div><dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Created</dt><dd className="text-ink-950 mt-0.5 text-xs font-medium">{formatDateTime(doc.createdAt)}</dd></div>
            {doc.hash && (
              <div className="col-span-2 md:col-span-4 xl:col-span-7">
                <dt className="text-ink-500 text-[10px] font-medium tracking-wider uppercase">Document fingerprint</dt>
                <dd className="text-ink-600 mt-0.5 font-mono text-[10px]">{abbreviatedDocumentHash(doc.hash)}</dd>
                <dd className="text-ink-400 mt-1 text-[10px]">The complete SHA-256 fingerprint and verification QR are available on the official PDF and public verification page.</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {versions.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Version History</CardTitle>
            <p className="text-ink-500 mt-1 text-xs">Every generated version remains addressable. Superseded records are retained for audit and verification.</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {versions.map((version) => {
                const isCurrent = version.id === doc.id;
                return (
                  <Link
                    key={version.id}
                    href={`/dashboard/documents/${version.id}`}
                    aria-current={isCurrent ? 'page' : undefined}
                    className={`border-border hover:bg-muted/50 flex items-center gap-3 rounded-[8px] border p-3 transition-colors ${isCurrent ? 'bg-muted/40' : ''}`}
                  >
                    <History className="text-ink-400 h-5 w-5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-ink-950 text-sm font-medium">Version {version.documentVersion}</p>
                        <Badge
                          variant={version.status === 'issued' ? 'success' : version.status === 'draft' ? 'pending' : 'cancelled'}
                          size="sm"
                        >
                          {formatDocumentStatus(version.status)}
                        </Badge>
                        {isCurrent && <Badge variant="info" size="sm">Viewing</Badge>}
                      </div>
                      <p className="text-ink-500 mt-0.5 text-xs">
                        {formatDateTime(version.createdAt)}
                        {version.hash ? ` · ${abbreviatedDocumentHash(version.hash)}` : ''}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
