/* eslint-disable react-hooks/error-boundaries */

import { getDb, isDbConnected } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';
import { eq, desc, and, sql, count } from 'drizzle-orm';
import Link from 'next/link';
import { StyledSelect } from '@/components/ui/styled-select';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  FileText,
  FileSpreadsheet,
  Database,
  ExternalLink,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { getServerSession } from '@/lib/session';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap } from '@/lib/statistics';

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

export default async function DocumentsPage({ searchParams }: PageProps) {
  const rawParams = await searchParams;
  const q = normalizeOptionalFilter(rawParams.q);
  const status = normalizeOptionalFilter(rawParams.status);
  const type = normalizeOptionalFilter(rawParams.type);
  const page = normalizeOptionalFilter(rawParams.page);
  const currentPage = Math.max(1, parseInt(page || '1', 10) || 1);
  const session = await getServerSession();
  if (!session) return null;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Documents' }]} />
        <PageHeader
          title="Documents"
          description="Generated document snapshots and secure sharing"
        />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const db = getDb();

  // Build where conditions
  const baseConditions = [eq(generatedDocuments.tenantId, session.tenantId)];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];
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
    const [[totalResult], statusCounts] = await Promise.all([
      db.select({ count: count() }).from(generatedDocuments).where(where),
      db
        .select({ key: generatedDocuments.status, count: count() })
        .from(generatedDocuments)
        .where(baseWhere)
        .groupBy(generatedDocuments.status),
    ]);

    const total = totalResult?.count ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));
    const counts = groupedCountMap(statusCounts);
    const overallTotal = [...counts.values()].reduce((sum, value) => sum + value, 0);

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
                <div className="bg-brand-100 text-brand-700 flex h-10 w-10 items-center justify-center rounded-lg">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-ink-950 text-2xl font-bold">{overallTotal}</p>
                  <p className="text-ink-500 text-xs">Total</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="bg-status-success-bg text-status-success-text flex h-10 w-10 items-center justify-center rounded-lg">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-ink-950 text-2xl font-bold">{counts.get('issued') ?? 0}</p>
                  <p className="text-ink-500 text-xs">Issued</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="bg-status-pending-bg text-status-pending-text flex h-10 w-10 items-center justify-center rounded-lg">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-ink-950 text-2xl font-bold">{counts.get('draft') ?? 0}</p>
                  <p className="text-ink-500 text-xs">Drafts</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <div className="bg-status-cancelled-bg text-status-cancelled-text flex h-10 w-10 items-center justify-center rounded-lg">
                  <ExternalLink className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-ink-950 text-2xl font-bold">{counts.get('superseded') ?? 0}</p>
                  <p className="text-ink-500 text-xs">Superseded</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="pt-4">
            <FilterToolbar
              action="/dashboard/documents"
              resetHref="/dashboard/documents"
              isFiltered={hasActiveFilters({ q, status, type })}
              className="gap-3"
            >
              <div className="min-w-[200px] flex-1">
                <label className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
                <LiveSearchInput name="q" defaultValue={q || ''} placeholder="Search documents…" />
              </div>
              <div>
                <label className="text-ink-500 mb-1 block text-xs font-medium">Type</label>
                <StyledSelect name="type" defaultValue={type || ''} placeholder="All Types">
                  {Object.entries(DOCUMENT_TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </StyledSelect>
              </div>
              <div>
                <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
                <StyledSelect name="status" defaultValue={status || ''} placeholder="All Statuses">
                  <option value="draft">Draft</option>
                  <option value="issued">Issued</option>
                  <option value="superseded">Superseded</option>
                </StyledSelect>
              </div>
            </FilterToolbar>
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
                  description={
                    hasActiveFilters({ q, status, type })
                      ? 'No matching records found. Clear filters to view all records.'
                      : 'Documents will appear here after they are generated from trips, requests, and inspections.'
                  }
                />
              </div>
            ) : (
              <div className="divide-border divide-y">
                {docs.map((doc) => {
                  const DocIcon = DOCUMENT_TYPE_ICONS[doc.documentType] || FileText;
                  return (
                    <Link
                      key={doc.id}
                      href={`/dashboard/documents/${doc.id}`}
                      className="hover:bg-muted/50 flex items-center gap-4 px-5 py-4 transition-colors"
                    >
                      <div className="bg-muted text-ink-600 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                        <DocIcon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-ink-950 truncate text-sm font-medium">
                            {DOCUMENT_TYPE_LABELS[doc.documentType] || doc.documentType}
                          </p>
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
                            {doc.status}
                          </Badge>
                        </div>
                        <p className="text-ink-500 mt-0.5 text-xs">
                          v{doc.documentVersion} · {formatDate(doc.createdAt)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-ink-500 text-xs">{formatDateTime(doc.createdAt)}</p>
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
            <p className="text-ink-500 text-xs">
              Page {currentPage} of {totalPages} ({total} total)
            </p>
            <div className="flex gap-2">
              {currentPage > 1 && (
                <Button variant="secondary" size="sm" asChild>
                  <Link
                    href={buildFilterUrl('/dashboard/documents', {
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
                    href={buildFilterUrl('/dashboard/documents', {
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
