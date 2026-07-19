import { getDb, isDbConnected } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, desc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, FileText, Search, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE, STATUS_LABELS, STATUS_VARIANTS } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

async function fetchRequests(sp: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = sp.search?.trim();
  const status = sp.status?.trim();
  const scope = sp.scope?.trim();

  const conditions: SQL[] = [eq(transportRequests.tenantId, tenantId)];

  if (status) {
    conditions.push(eq(transportRequests.status, status));
  }
  if (scope) {
    conditions.push(eq(transportRequests.scope, scope));
  }
  if (search) {
    conditions.push(
      or(
        like(transportRequests.reference, `%${search}%`),
        like(transportRequests.purpose, `%${search}%`),
        like(transportRequests.department, `%${search}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult, statusCounts] = await Promise.all([
    db
      .select({
        id: transportRequests.id,
        reference: transportRequests.reference,
        scope: transportRequests.scope,
        status: transportRequests.status,
        purpose: transportRequests.purpose,
        department: transportRequests.department,
        submittedAt: transportRequests.submittedAt,
        createdAt: transportRequests.createdAt,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
      })
      .from(transportRequests)
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(where)
      .orderBy(desc(transportRequests.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(transportRequests)
      .where(where),
    db
      .select({
        status: transportRequests.status,
        count: sql<number>`count(*)`,
      })
      .from(transportRequests)
      .groupBy(transportRequests.status),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);

  const approvalPending = statusCounts
    .filter((r) => ['submitted', 'supervisor_review', 'transport_review'].includes(r.status))
    .reduce((sum, r) => sum + r.count, 0);
  const activeCount = statusCounts
    .filter((r) => !['draft', 'closed', 'cancelled'].includes(r.status))
    .reduce((sum, r) => sum + r.count, 0);
  const closedCount = statusCounts
    .filter((r) => r.status === 'closed')
    .reduce((sum, r) => sum + r.count, 0);
  const draftCount = statusCounts
    .filter((r) => r.status === 'draft')
    .reduce((sum, r) => sum + r.count, 0);

  return {
    rows,
    totalCount,
    totalPages,
    page,
    approvalPending,
    activeCount,
    closedCount,
    draftCount,
    filters: { search, status, scope },
  };
}

function buildPageUrl(base: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

export default async function RequestsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const session = await getServerSession();

  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} />
        <PageHeader title="Transport Requests" description="Create and manage transport requests" />
        <EmptyState icon={<FileText className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view transport requests." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} />
        <PageHeader title="Transport Requests" description="Create and manage transport requests" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations to enable requests."
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchRequests>>;
  try {
    result = await fetchRequests(sp, session.tenantId);
  } catch (error) {
    console.error('Requests query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} />
        <PageHeader title="Transport Requests" description="Create and manage transport requests" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Requests"
          description="The database query failed. Please run migrations and seed first."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Requests' },
        ]}
      />
      <PageHeader
        title="Transport Requests"
        description="Create and manage transport requests across the council"
      >
        <Button variant="primary" size="sm" asChild>
          <Link href="/dashboard/requests/new">
            <Plus className="h-4 w-4" />
            New Request
          </Link>
        </Button>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-ink-950">{result.totalCount}</p>
              <p className="text-xs text-ink-500">Total Requests</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-pending-text">{result.approvalPending}</p>
              <p className="text-xs text-ink-500">Pending Approval</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-info-text">{result.activeCount}</p>
              <p className="text-xs text-ink-500">Active / In Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-success-text">{result.closedCount}</p>
              <p className="text-xs text-ink-500">Closed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  name="search"
                  defaultValue={result.filters.search ?? ''}
                  placeholder="Reference, purpose, department..."
                  className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Status</label>
              <select
                name="status"
                defaultValue={result.filters.status ?? ''}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">All Statuses</option>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <div className="w-[140px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Scope</label>
              <select
                name="scope"
                defaultValue={result.filters.scope ?? ''}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">All Scopes</option>
                <option value="regional">Regional</option>
                <option value="national">National</option>
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit">
              <Search className="h-4 w-4" /> Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Request List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No transport requests"
          description={
            result.filters.search
              ? 'Try adjusting your search or filter criteria.'
              : 'Create your first transport request to get started.'
          }
          action={
            !result.filters.search
              ? { label: 'New Request', onClick: () => {} }
              : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((req) => {
            const requesterName =
              req.requesterFirstName && req.requesterLastName
                ? `${req.requesterFirstName} ${req.requesterLastName}`
                : 'Unknown';
            const variant = STATUS_VARIANTS[req.status as keyof typeof STATUS_VARIANTS] ?? 'info';

            return (
              <Link
                key={req.id}
                href={`/dashboard/requests/${req.id}`}
                className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-[650] text-ink-950">{req.reference}</p>
                        <StatusBadge status={variant} label={STATUS_LABELS[req.status as keyof typeof STATUS_LABELS] ?? req.status} />
                        <Badge variant={req.scope === 'national' ? 'emergency' : 'info'} size="sm">
                          {req.scope === 'national' ? 'National' : 'Regional'}
                        </Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        <span>{requesterName}</span>
                        {req.department && <span>{req.department}</span>}
                        {req.purpose && <span className="truncate max-w-[200px]">{req.purpose}</span>}
                        <span>{formatDate(req.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-ink-300 shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-ink-500">
            Page {result.page} of {result.totalPages} ({result.totalCount} requests)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/requests', { ...sp, page: String(result.page - 1) })}>
                  <ChevronLeft className="h-3 w-3" /> Previous
                </Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/requests', { ...sp, page: String(result.page + 1) })}>
                  Next <ChevronRight className="h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
