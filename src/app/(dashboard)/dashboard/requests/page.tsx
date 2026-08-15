import Link from 'next/link';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb, isDbConnected } from '@/db';
import { externalParties } from '@/db/schema/external-parties';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { StyledSelect } from '@/components/ui/styled-select';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ChevronLeft, ChevronRight, Database, FileText, Plus, UserRoundPlus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE, STATUS_LABELS, STATUS_VARIANTS } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionPermissions, getSessionRoleNames } from '@/lib/auth-helpers';
import { canPerformDashboardAction, resolveDashboardAccess } from '@/lib/dashboard-access';
import { Permissions } from '@/lib/permissions';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap, numericCount, sumGroupedCounts } from '@/lib/statistics';
import { REQUEST_STATUS_GROUPS } from '@/lib/request-status';
import { requestScopeCondition } from '@/lib/record-scope';
import type { DashboardRecordScope } from '@/lib/dashboard-access';

interface PageProps { searchParams: Promise<Record<string, string | undefined>>; }

async function fetchRequests(sp: Record<string, string | undefined>, tenantId: string, userId: string, recordScope: DashboardRecordScope) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = normalizeOptionalFilter(sp.search);
  const status = normalizeOptionalFilter(sp.status);
  const scope = normalizeOptionalFilter(sp.scope);
  const viewMode = sp.view === 'mine' ? 'mine' : sp.view === 'all' ? 'all' : null;
  const effectiveScope: DashboardRecordScope = viewMode === 'mine' ? 'self' : recordScope;
  const baseConditions: SQL[] = [requestScopeCondition({ tenantId, userId, recordScope: effectiveScope })];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];
  if (status) conditions.push(eq(transportRequests.status, status));
  if (scope) conditions.push(eq(transportRequests.scope, scope));
  if (search) conditions.push(or(ilike(transportRequests.reference, `%${search}%`), ilike(transportRequests.purpose, `%${search}%`), ilike(transportRequests.department, `%${search}%`))!);
  const where = and(...conditions);

  const [rows, totalResult, metricTotalResult, statusCounts] = await Promise.all([
    db.select({
      id: transportRequests.id,
      reference: transportRequests.reference,
      requesterType: transportRequests.requesterType,
      scope: transportRequests.scope,
      status: transportRequests.status,
      purpose: transportRequests.purpose,
      department: transportRequests.department,
      urgency: transportRequests.urgency,
      driverPreference: transportRequests.driverPreference,
      totalAuthorisedKilometres: transportRequests.totalAuthorisedKilometres,
      submittedAt: transportRequests.submittedAt,
      createdAt: transportRequests.createdAt,
      responsibleFirstName: employees.firstName,
      responsibleLastName: employees.lastName,
      externalRequesterFirstName: externalParties.firstName,
      externalRequesterLastName: externalParties.lastName,
      externalRequesterOrganisation: externalParties.organisationName,
      passengerCount: sql<number>`(select count(*)::int from request_passengers rp where rp.request_id = ${transportRequests.id})`,
      routeOrigin: sql<string | null>`(select rr.origin_name from request_routes rr where rr.request_id = ${transportRequests.id} order by rr.created_at asc limit 1)`,
      routeDestination: sql<string | null>`(select rr.destination_name from request_routes rr where rr.request_id = ${transportRequests.id} order by rr.created_at desc limit 1)`,
      routeKm: sql<number | null>`(select nullif(sum(coalesce(rr.total_kilometres, rr.mapped_distance_km, 0)), 0)::int from request_routes rr where rr.request_id = ${transportRequests.id})`,
      activityStart: sql<Date | null>`(select min(ra.start_date) from request_activities ra where ra.request_id = ${transportRequests.id})`,
      activityEnd: sql<Date | null>`(select max(ra.end_date) from request_activities ra where ra.request_id = ${transportRequests.id})`,
    }).from(transportRequests)
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .leftJoin(externalParties, eq(transportRequests.externalRequesterId, externalParties.id))
      .where(where).orderBy(desc(transportRequests.updatedAt), desc(transportRequests.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(transportRequests).where(where),
    db.select({ count: sql<number>`count(*)` }).from(transportRequests).where(baseWhere),
    db.select({ status: transportRequests.status, count: sql<number>`count(*)` }).from(transportRequests).where(baseWhere).groupBy(transportRequests.status),
  ]);
  const totalCount = numericCount(totalResult[0]?.count);
  const counts = groupedCountMap(statusCounts.map((row) => ({ key: row.status, count: row.count })));
  return {
    rows, totalCount, totalPages: Math.ceil(totalCount / limit), page,
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
  if (!session) return <div className="space-y-6"><Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} /><PageHeader title="Transport Requests" description="Create and manage transport requests" /><EmptyState icon={<FileText className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view transport requests." /></div>;
  if (!isDbConnected()) return <div className="space-y-6"><Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} /><PageHeader title="Transport Requests" description="Create and manage transport requests" /><EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Set the DATABASE_URL environment variable and run migrations to enable requests." /></div>;

  const [roleNames, permissionCodes] = await Promise.all([
    getSessionRoleNames(session),
    getSessionPermissions(session),
  ]);
  const access = resolveDashboardAccess('/dashboard/requests', roleNames);
  const canCreate = canPerformDashboardAction('/dashboard/requests/new', roleNames, 'create');
  const canCreateExternal = canCreate && permissionCodes.includes(Permissions.SECURE_REQUEST_ASSIST);
  const pageTitle = access.activeWorkspace === 'personal' ? 'My Requests' : access.activeWorkspace === 'transport_admin' ? 'Incoming Operational Requests' : 'Transport Request Oversight';
  const canViewAll = access.recordScope === 'tenant';
  const viewParam = sp.view === 'mine' ? 'mine' : sp.view === 'all' ? 'all' : null;
  const effectiveRecordScope: DashboardRecordScope = viewParam === 'mine' ? 'self' : access.recordScope ?? 'self';

  let result: Awaited<ReturnType<typeof fetchRequests>>;
  try { result = await fetchRequests(sp, session.tenantId, session.user.id, effectiveRecordScope); }
  catch (error) {
    console.error('Requests query failed:', error);
    return <div className="space-y-6"><Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} /><PageHeader title="Transport Requests" description="Create and manage transport requests" /><EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Requests" description="The request register could not be loaded. Please try again after checking the database connection." /></div>;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests' }]} />
      <PageHeader title={pageTitle} description={access.activeWorkspace === 'transport_admin' ? 'Operational context is shown here before you open a request for review or allocation.' : access.accessMode === 'tenant_read_only' || access.accessMode === 'tenant_read' ? 'Read-only tenant request oversight' : canViewAll ? 'Review and manage transport requests' : 'Create and follow your requests'}>
        {canViewAll && <div className="border-border flex items-center rounded-[8px] border p-0.5"><Button variant={viewParam !== 'mine' ? 'primary' : 'ghost'} size="sm" asChild><Link href={buildFilterUrl('/dashboard/requests', sp, { view: 'all', page: undefined })}>All Requests</Link></Button><Button variant={viewParam === 'mine' ? 'primary' : 'ghost'} size="sm" asChild><Link href={buildFilterUrl('/dashboard/requests', sp, { view: 'mine', page: undefined })}>My Requests</Link></Button></div>}
        {canCreateExternal && <Button variant="secondary" size="sm" asChild><Link href="/dashboard/requests/external/new"><UserRoundPlus className="h-4 w-4" />External Request</Link></Button>}
        {canCreate && <Button size="sm" asChild><Link href="/dashboard/requests/new"><Plus className="h-4 w-4" />New Request</Link></Button>}
      </PageHeader>

      <div className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border lg:grid-cols-4">
        {[
          ['Total Requests', result.metrics.total, 'text-ink-950'], ['Pending Approval', result.metrics.pendingApproval, 'text-status-pending-text'], ['Active', result.metrics.active, 'text-status-info-text'], ['Closed', result.metrics.closed, 'text-status-success-text'],
        ].map(([label, value, tone]) => <div key={String(label)} className="bg-surface p-4"><p className={`text-xl font-semibold tabular-nums sm:text-2xl ${tone}`}>{value}</p><p className="text-ink-500 mt-1 text-xs">{label}</p></div>)}
      </div>

      <div className="border-border border-y py-4">
        <FilterToolbar resetHref="/dashboard/requests" isFiltered={hasActiveFilters(result.filters)} className="items-end">
          <div className="min-w-[220px] flex-1"><label className="text-ink-500 mb-1 block text-xs font-medium">Search</label><LiveSearchInput name="search" defaultValue={result.filters.search ?? ''} placeholder="Reference, purpose, department…" /></div>
          <div className="w-full sm:w-[190px]"><label className="text-ink-500 mb-1 block text-xs font-medium">Status</label><StyledSelect name="status" defaultValue={result.filters.status ?? ''} placeholder="All Statuses">{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</StyledSelect></div>
          <div className="w-full sm:w-[150px]"><label className="text-ink-500 mb-1 block text-xs font-medium">Scope</label><StyledSelect name="scope" defaultValue={result.filters.scope ?? ''} placeholder="All Scopes"><option value="regional">Regional</option><option value="national">National</option></StyledSelect></div>
        </FilterToolbar>
      </div>

      {result.rows.length === 0 ? <EmptyState icon={<FileText className="h-8 w-8" />} title="No transport requests" description={hasActiveFilters(result.filters) ? 'No matching records found. Clear filters to view all records.' : canCreate ? 'Create your first transport request to get started.' : 'No requests are currently available in this workspace.'} /> : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {result.rows.map((request) => {
            const isExternal = request.requesterType === 'external';
            const requesterName = isExternal ? request.externalRequesterFirstName && request.externalRequesterLastName ? `${request.externalRequesterFirstName} ${request.externalRequesterLastName}` : 'External requester' : request.responsibleFirstName && request.responsibleLastName ? `${request.responsibleFirstName} ${request.responsibleLastName}` : 'Unknown requester';
            const responsibleName = request.responsibleFirstName && request.responsibleLastName ? `${request.responsibleFirstName} ${request.responsibleLastName}` : null;
            const variant = STATUS_VARIANTS[request.status as keyof typeof STATUS_VARIANTS] ?? 'info';
            const detailHref = isExternal ? `/dashboard/requests/external/${request.id}` : `/dashboard/requests/${request.id}`;
            const km = request.routeKm ?? request.totalAuthorisedKilometres;
            return (
              <Link key={request.id} href={detailHref} className="focus-ring group border-border hover:bg-muted/40 block cursor-pointer border-b px-4 py-4 transition-colors motion-reduce:transition-none last:border-b-0 sm:px-5">
                <div className="flex items-start gap-3">
                  <div className="bg-brand-50 text-brand-700 mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px]"><FileText className="h-4 w-4" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><p className="text-ink-950 text-sm font-semibold">{request.reference}</p><StatusBadge status={variant} label={STATUS_LABELS[request.status as keyof typeof STATUS_LABELS] ?? request.status} />{isExternal && <Badge variant="info" size="sm">External</Badge>}<Badge variant={request.scope === 'national' ? 'emergency' : 'info'} size="sm">{request.scope === 'national' ? 'National' : 'Regional'}</Badge>{request.urgency !== 'normal' && <Badge variant="warning" size="sm">{request.urgency}</Badge>}</div>
                    {request.purpose && <p className="text-ink-800 mt-1 line-clamp-2 text-sm">{request.purpose}</p>}
                    <div className="text-ink-500 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs"><span>{requesterName}</span>{isExternal && request.externalRequesterOrganisation && <span>{request.externalRequesterOrganisation}</span>}{isExternal && responsibleName && <span>Internal owner: {responsibleName}</span>}{request.department && <span>{request.department}</span>}<span>Created {formatDate(request.createdAt)}</span></div>
                    <div className="border-border text-ink-600 mt-3 grid gap-x-5 gap-y-1 border-t pt-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
                      <span><strong className="text-ink-800 font-medium">Route:</strong> {request.routeOrigin || 'Not recorded'} → {request.routeDestination || 'Not recorded'}</span>
                      <span><strong className="text-ink-800 font-medium">Distance:</strong> {km == null ? 'Not estimated' : `${Number(km).toLocaleString()} km`}</span>
                      <span><strong className="text-ink-800 font-medium">Passengers:</strong> {request.passengerCount}</span>
                      <span><strong className="text-ink-800 font-medium">Travel:</strong> {request.activityStart ? formatDate(request.activityStart) : 'Not scheduled'}{request.activityEnd ? ` – ${formatDate(request.activityEnd)}` : ''}</span>
                    </div>
                  </div>
                  <ChevronRight className="text-ink-300 group-hover:text-brand-700 mt-1 h-4 w-4 shrink-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {result.totalPages > 1 && <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-ink-500 text-xs">Page {result.page} of {result.totalPages} ({result.totalCount} requests)</p><div className="flex items-center gap-2">{result.page > 1 && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/requests', sp, { page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" />Previous</Link></Button>}{result.page < result.totalPages && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/requests', sp, { page: String(result.page + 1) })}>Next<ChevronRight className="h-3 w-3" /></Link></Button>}</div></div>}
    </div>
  );
}
