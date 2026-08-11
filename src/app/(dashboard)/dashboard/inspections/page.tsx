import Link from 'next/link';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { getDb, isDbConnected } from '@/db';
import { vehicleInspections } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { ChevronLeft, ChevronRight, ClipboardCheck, Database } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames, hasPermission } from '@/lib/auth-helpers';
import { canPerformDashboardAction, resolveDashboardAccess } from '@/lib/dashboard-access';
import { Permissions } from '@/lib/permissions';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { numericCount } from '@/lib/statistics';
import { inspectionScopeCondition } from '@/lib/record-scope';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const INSPECTION_TYPE_LABELS: Record<string, string> = {
  departure: 'Departure',
  return: 'Return',
};

async function fetchInspections(
  sp: Record<string, string | undefined>,
  tenantId: string,
  userId: string,
  recordScope: 'self' | 'assigned' | 'related' | 'tenant' | 'platform' | null,
) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const type = normalizeOptionalFilter(sp.type);
  const status = normalizeOptionalFilter(sp.status);
  const search = normalizeOptionalFilter(sp.search);

  const baseConditions: SQL[] = [
    inspectionScopeCondition({ tenantId, userId, recordScope: recordScope ?? 'assigned' }),
  ];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (type) conditions.push(eq(vehicleInspections.type, type));
  if (status) conditions.push(eq(vehicleInspections.status, status));
  if (search) {
    conditions.push(
      or(
        ilike(vehicles.licenceNumber, `%${search}%`),
        ilike(vehicles.make, `%${search}%`),
        ilike(vehicles.model, `%${search}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [rows, totalResult, summary] = await Promise.all([
    db
      .select({
        id: vehicleInspections.id,
        type: vehicleInspections.type,
        status: vehicleInspections.status,
        odometerReading: vehicleInspections.odometerReading,
        fuelLevel: vehicleInspections.fuelLevel,
        overallPass: vehicleInspections.overallPass,
        createdAt: vehicleInspections.createdAt,
        vehicleId: vehicleInspections.vehicleId,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
      })
      .from(vehicleInspections)
      .leftJoin(vehicles, eq(vehicleInspections.vehicleId, vehicles.id))
      .where(where)
      .orderBy(desc(vehicleInspections.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(vehicleInspections).where(where),
    db
      .select({
        type: vehicleInspections.type,
        status: vehicleInspections.status,
        pass: vehicleInspections.overallPass,
        count: sql<number>`count(*)`,
      })
      .from(vehicleInspections)
      .where(baseWhere)
      .groupBy(vehicleInspections.type, vehicleInspections.status, vehicleInspections.overallPass),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const totalInspections = summary.reduce((sum, row) => sum + numericCount(row.count), 0);
  const departureCount = summary.filter((row) => row.type === 'departure').reduce((sum, row) => sum + numericCount(row.count), 0);
  const returnCount = summary.filter((row) => row.type === 'return').reduce((sum, row) => sum + numericCount(row.count), 0);
  const passCount = summary.filter((row) => row.pass === true).reduce((sum, row) => sum + numericCount(row.count), 0);
  const failCount = summary.filter((row) => row.pass === false).reduce((sum, row) => sum + numericCount(row.count), 0);
  const passRate = totalInspections > 0 ? Math.round((passCount / totalInspections) * 100) : 0;

  return {
    rows,
    totalCount,
    totalPages,
    page,
    filters: { type, status, search },
    summary: { totalInspections, departureCount, returnCount, passCount, failCount, passRate },
  };
}

export default async function InspectionsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const activeTab = sp.type || '';
  const session = await getServerSession();

  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections' }]} />
        <PageHeader title="Vehicle Inspections" description="Pre-trip departure and post-trip return inspections" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view inspections." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections' }]} />
        <PageHeader title="Vehicle Inspections" description="Pre-trip departure and post-trip return inspections" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/inspections', roleNames);
  const canCreate =
    canPerformDashboardAction('/dashboard/inspections/new', roleNames, 'create') &&
    await hasPermission(session, Permissions.INSPECTION_PERFORM);
  let result: Awaited<ReturnType<typeof fetchInspections>>;
  try {
    result = await fetchInspections(sp, session.tenantId, session.user.id, access.recordScope);
  } catch (error) {
    console.error('Inspections query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections' }]} />
        <PageHeader title="Vehicle Inspections" description="Pre-trip departure and post-trip return inspections" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Inspections" />
      </div>
    );
  }

  const summary = [
    { label: 'Total', value: result.summary.totalInspections, tone: 'text-ink-950' },
    { label: 'Departure', value: result.summary.departureCount, tone: 'text-brand-700' },
    { label: 'Return', value: result.summary.returnCount, tone: 'text-brand-700' },
    { label: 'Passed', value: result.summary.passCount, tone: 'text-status-success-text' },
    { label: 'Failed', value: result.summary.failCount, tone: 'text-status-error-text' },
    { label: 'Pass Rate', value: `${result.summary.passRate}%`, tone: 'text-ink-950' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections' }]} />
      <PageHeader title="Vehicle Inspections" description={canCreate ? 'Perform and review official vehicle inspections' : 'View official inspection records within your assigned scope'}>
        {canCreate && (
          <>
            <Button variant="secondary" size="sm" asChild><Link href="/dashboard/inspections/new?type=departure"><ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Departure Inspection</Link></Button>
            <Button variant="secondary" size="sm" asChild><Link href="/dashboard/inspections/new?type=return"><ClipboardCheck className="h-4 w-4" aria-hidden="true" /> Return Inspection</Link></Button>
          </>
        )}
      </PageHeader>

      <nav className="flex flex-wrap gap-2" aria-label="Inspection type filters">
        <Link href="/dashboard/inspections" aria-current={!activeTab ? 'page' : undefined} className={`focus-ring inline-flex min-h-8 items-center rounded-full border px-3.5 text-xs font-medium transition-colors motion-reduce:transition-none ${!activeTab ? 'border-brand-700 bg-brand-700 text-white' : 'border-border bg-surface text-ink-600 hover:bg-muted'}`}>All</Link>
        {Object.entries(INSPECTION_TYPE_LABELS).map(([value, label]) => (
          <Link key={value} href={buildFilterUrl('/dashboard/inspections', {}, { type: value })} aria-current={activeTab === value ? 'page' : undefined} className={`focus-ring inline-flex min-h-8 items-center rounded-full border px-3.5 text-xs font-medium transition-colors motion-reduce:transition-none ${activeTab === value ? 'border-brand-700 bg-brand-700 text-white' : 'border-border bg-surface text-ink-600 hover:bg-muted'}`}>{label}</Link>
        ))}
      </nav>

      <section aria-label="Inspection summary" className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border sm:grid-cols-3 xl:grid-cols-6">
        {summary.map((item) => (
          <div key={item.label} className="bg-surface px-4 py-4"><p className={`text-xl font-semibold tabular-nums ${item.tone}`}>{item.value}</p><p className="text-ink-500 mt-0.5 text-xs">{item.label}</p></div>
        ))}
      </section>

      <Card>
        <CardContent className="pt-4">
          <FilterToolbar resetHref={activeTab ? `/dashboard/inspections?type=${activeTab}` : '/dashboard/inspections'} isFiltered={hasActiveFilters(result.filters, ['page', 'type'])}>
            <div className="min-w-[200px] flex-1">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Search Vehicle</label>
              <LiveSearchInput name="search" defaultValue={result.filters.search ?? ''} placeholder="Licence, make, model…" />
            </div>
            <div className="w-full sm:w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
              <StyledSelect name="status" defaultValue={result.filters.status ?? ''} placeholder="All Statuses">
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </StyledSelect>
            </div>
            <input type="hidden" name="type" value={activeTab} />
          </FilterToolbar>
        </CardContent>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" />}
          title="No inspections found"
          description={hasActiveFilters(result.filters, ['page', 'type']) ? 'No matching records found. Clear filters to view all records.' : activeTab ? `No ${activeTab} inspections recorded yet.` : 'No vehicle inspections recorded yet.'}
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {result.rows.map((inspection) => (
            <Link key={inspection.id} href={`/dashboard/inspections/${inspection.id}`} className="focus-ring border-border group block border-b p-4 transition-colors last:border-b-0 hover:bg-muted/40 motion-reduce:transition-none sm:p-5">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-[8px] sm:flex ${inspection.overallPass === true ? 'bg-status-success-bg text-status-success-text' : inspection.overallPass === false ? 'bg-status-error-bg text-status-error-text' : 'bg-muted text-ink-500'}`}><ClipboardCheck className="h-5 w-5" aria-hidden="true" /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ink-950 text-sm font-semibold capitalize">{inspection.type} Inspection</p>
                    <Badge variant={inspection.status === 'completed' ? 'success' : 'error'} size="sm">{inspection.status?.replace(/_/g, ' ')}</Badge>
                    {inspection.overallPass != null && <Badge variant={inspection.overallPass ? 'success' : 'error'} size="sm">{inspection.overallPass ? 'Pass' : 'Fail'}</Badge>}
                  </div>
                  <div className="text-ink-500 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span>{inspection.make} {inspection.model}</span><span className="tabular-nums">{inspection.licenceNumber}</span>{inspection.odometerReading != null && <span>{inspection.odometerReading.toLocaleString()} km</span>}<span className="tabular-nums">{formatDate(inspection.createdAt)}</span>
                  </div>
                </div>
                <ChevronRight className="text-ink-300 group-hover:text-brand-700 mt-1 h-4 w-4 shrink-0" aria-hidden="true" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink-500 text-xs">Page {result.page} of {result.totalPages} ({result.totalCount} inspections)</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/inspections', sp, { page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" aria-hidden="true" /> Previous</Link></Button>}
            {result.page < result.totalPages && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/inspections', sp, { page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" aria-hidden="true" /></Link></Button>}
          </div>
        </div>
      )}
    </div>
  );
}
