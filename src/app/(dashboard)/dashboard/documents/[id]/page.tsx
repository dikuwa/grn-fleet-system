import { getDb, isDbConnected } from '@/db';
import { generatedDocuments, shareLinks } from '@/db/schema/documents';
import { eq, desc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FileText,
  Download,
  Share2,
  Clock,
  Database,
  ChevronLeft,
  CheckCircle2,
  XCircle,
  Link2,
  Trash2,
  History,
  Eye,
  Plus,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createElement } from 'react';

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchDocumentDetail(id: string) {
  const db = getDb();

  const [doc] = await db
    .select()
    .from(generatedDocuments)
    .where(eq(generatedDocuments.id, id))
    .limit(1);

  if (!doc) notFound();

  const shares = await db
    .select()
    .from(shareLinks)
    .where(eq(shareLinks.documentId, id))
    .orderBy(desc(shareLinks.createdAt));

  return { doc, shares };
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

  let data: Awaited<ReturnType<typeof fetchDocumentDetail>>;
  try {
    data = await fetchDocumentDetail(id);
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

  const { doc, shares } = data;

  const statusIcon = doc.status === 'issued' ? CheckCircle2 :
    doc.status === 'draft' ? Clock : XCircle;
  const statusColor = doc.status === 'issued' ? 'text-status-success-text bg-status-success-bg' :
    doc.status === 'draft' ? 'text-status-pending-text bg-status-pending-bg' :
    'text-status-cancelled-text bg-status-cancelled-bg';

  // Count active shares
  const activeShares = shares.filter(
    (s) => !s.isRevoked && new Date(s.expiresAt) > new Date(),
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Documents', href: '/dashboard/documents' },
        { label: doc.documentType },
      ]} />
      <PageHeader
        title={`${doc.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}`}
        description={`Version ${doc.documentVersion} · ${formatDate(doc.createdAt)}`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/documents"><ChevronLeft className="h-4 w-4" /> Back</Link>
        </Button>
        <Button variant="primary" size="sm">
          <Download className="h-4 w-4" /> Download PDF
        </Button>
        <Button variant="secondary" size="sm">
          <Share2 className="h-4 w-4" /> Share
        </Button>
      </PageHeader>

      {/* Status Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] ${statusColor}`}>
              {createElement(statusIcon, { className: 'h-7 w-7' })}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950">{doc.documentType.replace(/_/g, ' ')}</h2>
                <Badge variant={
                  doc.status === 'issued' ? 'success' :
                  doc.status === 'draft' ? 'pending' :
                  'cancelled'
                } size="sm">{doc.status}</Badge>
                <Badge variant="info" size="sm">v{doc.documentVersion}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
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
            <Button variant="secondary" size="sm"><Download className="h-4 w-4" /> PDF</Button>
            <Button variant="secondary" size="sm"><Eye className="h-4 w-4" /> Preview</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-[10px] border border-border bg-muted/30 p-6">
            <div className="mx-auto max-w-[210mm] min-h-[297mm] bg-white shadow-sm rounded-[4px] p-[14mm]">
              {/* Document Header */}
              <div className="border-b border-brand-300 pb-4 mb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-ink-500">Kavango East Regional Council</p>
                    <p className="text-lg font-bold text-ink-950">
                      {doc.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </p>
                  </div>
                  <Badge variant="pending" size="sm">DRAFT</Badge>
                </div>
                <p className="text-xs text-ink-400 mt-1">Reference: {doc.id.slice(0, 8)} · v{doc.documentVersion}</p>
              </div>

              {/* Snapshot Data */}
              {doc.snapshotData && Object.keys(doc.snapshotData).length > 0 ? (
                <div className="space-y-3 text-sm">
                  {Object.entries(doc.snapshotData).map(([key, value]) => (
                    <div key={key} className="flex border-b border-border/50 py-1.5">
                      <span className="w-1/3 font-medium text-ink-700 text-xs uppercase tracking-wider">
                        {key.replace(/_/g, ' ')}
                      </span>
                      <span className="w-2/3 text-ink-900">
                        {typeof value === 'object' ? JSON.stringify(value) : String(value ?? 'N/A')}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <FileText className="h-8 w-8 text-ink-300 mb-2" />
                  <p className="text-sm text-ink-500">Document content snapshot not available</p>
                  <p className="text-xs text-ink-400 mt-1">The document will render after generation.</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Metadata Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Document Metadata</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-ink-500">Type</span>
              <span className="font-medium text-ink-950">{doc.documentType}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-ink-500">Version</span>
              <span className="font-medium text-ink-950">{doc.documentVersion}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-ink-500">Template Version</span>
              <span className="font-medium text-ink-950">{doc.templateVersion || 'N/A'}</span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-ink-500">Status</span>
              <span className="font-medium"><Badge variant={
                doc.status === 'issued' ? 'success' :
                doc.status === 'draft' ? 'pending' : 'cancelled'
              } size="sm">{doc.status}</Badge></span>
            </div>
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-ink-500">Redaction Profile</span>
              <span className="font-medium text-ink-950">{doc.redactionProfile || 'internal'}</span>
            </div>
            {doc.hash && (
              <div className="flex justify-between border-b border-border/50 pb-2">
                <span className="text-ink-500">Hash</span>
                <span className="font-mono text-xs text-ink-600 truncate max-w-[200px]">{doc.hash}</span>
              </div>
            )}
            <div className="flex justify-between border-b border-border/50 pb-2">
              <span className="text-ink-500">Generated By</span>
              <span className="font-medium text-ink-950">{doc.generatedByUserId.slice(0, 8)}</span>
            </div>
            <div className="flex justify-between pb-2">
              <span className="text-ink-500">Created</span>
              <span className="font-medium text-ink-950">{formatDateTime(doc.createdAt)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Secure Sharing</CardTitle>
            <Button variant="secondary" size="sm"><Plus className="h-4 w-4" /> Create Link</Button>
          </CardHeader>
          <CardContent>
            {activeShares.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Link2 className="h-8 w-8 text-ink-300 mb-2" />
                <p className="text-sm text-ink-500">No active share links</p>
                <p className="text-xs text-ink-400 mt-1">Create a secure share link to share this document externally.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {activeShares.map((share) => (
                  <div
                    key={share.id}
                    className="flex items-center justify-between rounded-[8px] border border-border bg-muted/30 p-3"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <Link2 className="h-4 w-4 text-brand-600" />
                        <span className="text-sm text-ink-950 font-medium">Share Link</span>
                        {share.isRevoked && <Badge variant="error" size="sm">Revoked</Badge>}
                      </div>
                      <p className="text-xs text-ink-500 mt-1">
                        Expires {formatDate(share.expiresAt)} · {share.currentViews}/{share.maxViews || '∞'} views
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm">
                        <Link2 className="h-4 w-4" /> Copy
                      </Button>
                      <Button variant="secondary" size="sm" className="text-status-error-text">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Version History */}
      {doc.documentVersion > 1 && (
        <Card>
          <CardHeader><CardTitle>Version History</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-3 rounded-[8px] border border-border p-4">
              <History className="h-5 w-5 text-ink-400" />
              <div>
                <p className="text-sm font-medium text-ink-950">Version {doc.documentVersion}</p>
                <p className="text-xs text-ink-500">Current version. Prior versions are available in the document history.</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
