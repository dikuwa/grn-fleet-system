import { getDb, isDbConnected } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, desc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { StyledSelect } from '@/components/ui/styled-select';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, FileText, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE, STATUS_LABELS, STATUS_VARIANTS } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import {
  canPerformDashboardAction,
  resolveDashboardAccess,
  SystemRoles,
} from '@/lib/dashboard-access';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap, numericCount, sumGroupedCounts } from '@/lib/statistics';
import { REQUEST_STATUS_GROUPS } from '@/lib/request-status';
import { requestScopeCondition } from '@/lib/record-scope';
import type { DashboardRecordScope } from '@/lib/dashboard-access';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

async function fetchRequests(
  sp: Record<string, string | undefined>,
  tenantId: string,
  userId: string,
  recordScope: DashboardRecordScope,
) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = normalizeOptionalFilter(sp.search);
  const status = normalizeOptionalFilter(sp.status);
  const scope = normalizeOptionalFilter(sp.scope);

  const baseConditions: SQL[] = [requestScopeCondition({ tenantId, userId, recordScope })];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

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

  const [rows, totalResult, metricTotalResult, statusCounts] = await Promise.all([
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
      .select({ count: sql<number>`count(*)` })
      .from(transportRequests)
      .where(baseWhere),
    db
      .select({
        status: transportRequests.status,
        count: sql<number>`count(*)`,
      })
      .from(transportRequests)
      .where(baseWhere)
      .groupBy(transportRequests.status),
  ]);

  const totalCount = numericCount(totalResult[0]?.count);
  const totalPages = Math.ceil(totalCount / limit);
  const counts = groupedCountMap(
    statusCounts.map((row) => ({ key: row.status, count: row.count })),
  );

  return {
    rows,
    totalCount,
    totalPages,
    page,
    metrics: {
      total: numericCount(metricTotalResult[0]?.count),
      pendingApproval: sumGroupedCounts(counts, REQUEST_STATUS_GROUPS.pendingApproval),
      active: sumGroupedCounts(counts, REQUEST_STATUS_GROUPS.active),
      closed: sumGroupedCounts(counts, REQUEST_STATUS_GROUPS.closed),
    },
    filters: { search, status, scope },
  };
}

export default async function RequestsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const session = await getServerSession();

  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} />
        <PageHeader title="Transport Requests" description="Create and manage transport requests" />
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="Authentication Required"
          description="Please sign in to view transport requests."
        />
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

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/requests', roleNames);
  const canViewAll = access.recordScope === 'tenant';
  const canCreate = canPerformDashboardAction('/dashboard/requests/new', roleNames, 'create');
  const pageTitle = roleNames.includes(SystemRoles.REQUESTER)
    ? 'My Requests'
    : roleNames.includes(SystemRoles.TRANSPORT_ADMIN)
      ? 'Operational Requests'
      : 'Transport Request Oversight';
  let result: Awaited<ReturnType<typeof fetchRequests>>;
  try {
    result = await fetchRequests(
      sp,
      session.tenantId,
      session.user.id,
      access.recordScope ?? 'self',
    );
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
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} />
      <PageHeader
        title={pageTitle}
        description={
          access.accessMode === 'tenant_read_only' || access.accessMode === 'tenant_read'
            ? 'Read-only tenant request oversight'
            : canViewAll
              ? 'Review and manage transport requests'
              : 'Create and follow your requests'
        }
      >
        {canCreate && (
          <Button variant="primary" size="sm" asChild>
            <Link href="/dashboard/requests/new">
              <Plus className="h-4 w-4" />
              New Request
            </Link>
          </Button>
        )}
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-ink-950 text-2xl font-[650] tabular-nums">
                {result.metrics.total}
              </p>
              <p className="text-ink-500 text-xs">Total Requests</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-status-pending-text text-2xl font-[650] tabular-nums">
                {result.metrics.pendingApproval}
              </p>
              <p className="text-ink-500 text-xs">Pending Approval</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-status-info-text text-2xl font-[650] tabular-nums">
                {result.metrics.active}
              </p>
              <p className="text-ink-500 text-xs">Active / In Progress</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-status-success-text text-2xl font-[650] tabular-nums">
                {result.metrics.closed}
              </p>
              <p className="text-ink-500 text-xs">Closed</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar
            resetHref="/dashboard/requests"
            isFiltered={hasActiveFilters(result.filters)}
          >
            <div className="min-w-[200px] flex-1">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
              <LiveSearchInput
                name="search"
                defaultValue={result.filters.search ?? ''}
                placeholder="Reference, purpose, department…"
              />
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
              <StyledSelect
                name="status"
                defaultValue={result.filters.status ?? ''}
                placeholder="All Statuses"
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="w-[140px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Scope</label>
              <StyledSelect
                name="scope"
                defaultValue={result.filters.scope ?? ''}
                placeholder="All Scopes"
              >
                <option value="regional">Regional</option>
                <option value="national">National</option>
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Request List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No transport requests"
          description={
            hasActiveFilters(result.filters)
              ? 'No matching records found. Clear filters to view all records.'
              : 'Create your first transport request to get started.'
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
                className="border-border bg-surface hover:border-brand-100 block rounded-[10px] border p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="bg-brand-50 text-brand-700 flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px]">
                      <FileText className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-ink-950 text-sm font-[650]">{req.reference}</p>
                        <StatusBadge
                          status={variant}
                          label={
                            STATUS_LABELS[req.status as keyof typeof STATUS_LABELS] ?? req.status
                          }
                        />
                        <Badge variant={req.scope === 'national' ? 'emergency' : 'info'} size="sm">
                          {req.scope === 'national' ? 'National' : 'Regional'}
                        </Badge>
                      </div>
                      <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span>{requesterName}</span>
                        {req.department && <span>{req.department}</span>}
                        {req.purpose && (
                          <span className="max-w-[200px] truncate">{req.purpose}</span>
                        )}
                        <span>{formatDate(req.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="text-ink-300 h-4 w-4 shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="border-border flex items-center justify-between border-t pt-4">
          <p className="text-ink-500 text-xs">
            Page {result.page} of {result.totalPages} ({result.totalCount} requests)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/requests', sp, {
                    page: String(result.page - 1),
                  })}
                >
                  <ChevronLeft className="h-3 w-3" /> Previous
                </Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/requests', sp, {
                    page: String(result.page + 1),
                  })}
                >
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
