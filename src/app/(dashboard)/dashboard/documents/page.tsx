/* eslint-disable react-hooks/error-boundaries */

import { getDb, isDbConnected } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { eq, desc, and, sql, count } from 'drizzle-orm';
import Link from 'next/link';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FileText,
  FileSpreadsheet,
  Search,
  Database,
  ExternalLink,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';

interface PageProps {
  searchParams: Promise<{ q?: string; type?: string; status?: string; page?: string }>;
}

const DOCUMENT_TYPE_ICONS: Record<string, typeof FileText> = {
  transport_request: FileText,
  trip_authority: FileText,
  vehicle_allocation: FileSpreadsheet,
  fuel_summary: FileSpreadsheet,
  inspection_report: FileText,
  trip_completion: FileText,
  maintenance_report: FileText,
  audit_report: FileText,
};

const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  transport_request: 'Transport Request',
  trip_authority: 'Trip Authority',
  vehicle_allocation: 'Vehicle Allocation',
  fuel_summary: 'Fuel Summary',
  inspection_report: 'Inspection Report',
  trip_completion: 'Trip Completion',
  maintenance_report: 'Maintenance Report',
  audit_report: 'Audit Report',
};

function buildPageUrl(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value);
  });
  const qs = search.toString();
  return `/dashboard/documents${qs ? `?${qs}` : ''}`;
}

export default async function DocumentsPage({ searchParams }: PageProps) {
  const { q, status, type, page } = await searchParams;
  const currentPage = Math.max(1, parseInt(page || '1', 10) || 1);

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Documents' }]} />
        <PageHeader title="Documents" description="Generated document snapshots and secure sharing" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const db = getDb();

  // Build where conditions
  const conditions = [];
  if (type) {
    conditions.push(eq(generatedDocuments.documentType, type));
  }
  if (status) {
    conditions.push(eq(generatedDocuments.status, status));
  }
  if (q) {
    conditions.push(sql`${generatedDocuments.documentType}::text ILIKE ${`%${q}%`}`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  try {
    const [totalResult] = await db
      .select({ count: count() })
      .from(generatedDocuments)
      .where(where);

    const total = totalResult?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));

    const docs = await db
      .select()
      .from(generatedDocuments)
      .where(where)
      .orderBy(desc(generatedDocuments.createdAt))
      .limit(DEFAULT_PAGE_SIZE)
      .offset((currentPage - 1) * DEFAULT_PAGE_SIZE);

    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Documents' }]} />
        <PageHeader
          title="Documents"
          description={`${total} generated document${total !== 1 ? 's' : ''}`}
        />

        {/* Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-ink-950">{total}</p>
                  <p className="text-xs text-ink-500">Total</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-success-bg text-status-success-text">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-ink-950">
                    {docs.filter((d) => d.status === 'issued').length}
                  </p>
                  <p className="text-xs text-ink-500">Issued</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-pending-bg text-status-pending-text">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-ink-950">
                    {docs.filter((d) => d.status === 'draft').length}
                  </p>
                  <p className="text-xs text-ink-500">Drafts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-status-cancelled-bg text-status-cancelled-text">
                  <ExternalLink className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-ink-950">
                    {docs.filter((d) => d.status === 'superseded').length}
                  </p>
                  <p className="text-xs text-ink-500">Superseded</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <form method="GET" action="/dashboard/documents" className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-xs font-medium text-ink-500 mb-1">Search</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <input
                    name="q"
                    type="text"
                    defaultValue={q || ''}
                    placeholder="Search documents..."
                    className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1">Type</label>
                <select
                  name="type"
                  defaultValue={type || ''}
                  className="h-10 rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">All Types</option>
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink-500 mb-1">Status</label>
                <select
                  name="status"
                  defaultValue={status || ''}
                  className="h-10 rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
                >
                  <option value="">All Statuses</option>
                  <option value="draft">Draft</option>
                  <option value="issued">Issued</option>
                  <option value="superseded">Superseded</option>
                </select>
              </div>
              <Button variant="primary" size="sm" type="submit">Filter</Button>
              {(q || status || type) && (
                <Button variant="secondary" size="sm" asChild>
                  <Link href="/dashboard/documents">Clear</Link>
                </Button>
              )}
            </form>
          </CardContent>
        </Card>

        {/* Documents List */}
        <Card>
          <CardContent className="p-0">
            {docs.length === 0 ? (
              <div className="py-12">
                <EmptyState
                  icon={<FileText className="h-6 w-6" />}
                  title="No documents yet"
                  description="Documents will appear here after they are generated from trips, requests, and inspections."
                />
              </div>
            ) : (
              <div className="divide-y divide-border">
                {docs.map((doc) => {
                  const DocIcon = DOCUMENT_TYPE_ICONS[doc.documentType] || FileText;
                  return (
                    <Link
                      key={doc.id}
                      href={`/dashboard/documents/${doc.id}`}
                      className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-ink-600">
                        <DocIcon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink-950 truncate">
                            {DOCUMENT_TYPE_LABELS[doc.documentType] || doc.documentType}
                          </p>
                          <Badge
                            variant={doc.status === 'issued' ? 'success' : doc.status === 'draft' ? 'pending' : 'cancelled'}
                            size="sm"
                          >
                            {doc.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-ink-500 mt-0.5">
                          v{doc.documentVersion} · {formatDate(doc.createdAt)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-ink-500">{formatDateTime(doc.createdAt)}</p>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-xs text-ink-500">
              Page {currentPage} of {totalPages} ({total} total)
            </p>
            <div className="flex gap-2">
              {currentPage > 1 && (
                <Button variant="secondary" size="sm" asChild>
                  <Link
                    href={buildPageUrl({
                      q: q || undefined,
                      type: type || undefined,
                      status: status || undefined,
                      page: String(currentPage - 1),
                    })}
                  >
                    Previous
                  </Link>
                </Button>
              )}
              {currentPage < totalPages && (
                <Button variant="secondary" size="sm" asChild>
                  <Link
                    href={buildPageUrl({
                      q: q || undefined,
                      type: type || undefined,
                      status: status || undefined,
                      page: String(currentPage + 1),
                    })}
                  >
                    Next
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  } catch (error) {
    console.error('Documents query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Documents' }]} />
        <PageHeader title="Documents" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Documents" />
      </div>
    );
  }
}
