import Link from 'next/link';
import { and, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { getDb, isDbConnected } from '@/db';
import { fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { ChevronLeft, ChevronRight, Database, Fuel, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatCurrency, formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { canPerformDashboardAction, resolveDashboardAccess } from '@/lib/dashboard-access';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { numericCount } from '@/lib/statistics';
import { fuelScopeCondition } from '@/lib/record-scope';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const driverEmp = alias(employees, 'fuel_driver');

async function fetchFuelEntries(
  sp: Record<string, string | undefined>,
  tenantId: string,
  userId: string,
  recordScope: 'self' | 'assigned' | 'related' | 'tenant' | 'platform' | null,
) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = normalizeOptionalFilter(sp.search);
  const paymentMethod = normalizeOptionalFilter(sp.payment_method);
  const anomalyState = normalizeOptionalFilter(sp.anomaly_state);

  const baseConditions: SQL[] = [
    fuelScopeCondition({ tenantId, userId, recordScope: recordScope ?? 'self' }),
  ];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (paymentMethod) conditions.push(eq(fuelTransactions.paymentMethod, paymentMethod));
  if (anomalyState) conditions.push(eq(fuelTransactions.anomalyState, anomalyState));
  if (search) {
    conditions.push(
      or(
        ilike(vehicles.licenceNumber, `%${search}%`),
        ilike(vehicles.make, `%${search}%`),
        ilike(fuelTransactions.stationName, `%${search}%`),
        ilike(fuelTransactions.referenceNumber, `%${search}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [rows, totalResult, metricResult] = await Promise.all([
    db
      .select({
        id: fuelTransactions.id,
        transactionAt: fuelTransactions.transactionAt,
        stationName: fuelTransactions.stationName,
        fuelType: fuelTransactions.fuelType,
        litres: fuelTransactions.litres,
        amount: fuelTransactions.amount,
        paymentMethod: fuelTransactions.paymentMethod,
        anomalyState: fuelTransactions.anomalyState,
        isVerified: fuelTransactions.isVerified,
        vehicleId: fuelTransactions.vehicleId,
        driverEmployeeId: fuelTransactions.driverEmployeeId,
        driverName: sql<string>`concat_ws(' ', ${driverEmp.firstName}, ${driverEmp.lastName})`,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        tripId: fuelTransactions.tripId,
      })
      .from(fuelTransactions)
      .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .leftJoin(driverEmp, eq(fuelTransactions.driverEmployeeId, driverEmp.id))
      .where(where)
      .orderBy(desc(fuelTransactions.transactionAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(fuelTransactions)
      .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(where),
    db
      .select({
        total: sql<number>`count(*)`,
        litres: sql<string>`coalesce(sum(${fuelTransactions.litres}), 0)`,
        cost: sql<string>`coalesce(sum(${fuelTransactions.amount}), 0)`,
        flagged: sql<number>`count(*) filter (where ${fuelTransactions.anomalyState} <> 'none')`,
      })
      .from(fuelTransactions)
      .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(baseWhere),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const metrics = metricResult[0];
  return {
    rows,
    totalCount,
    totalPages,
    page,
    metrics: {
      total: numericCount(metrics?.total),
      litres: numericCount(metrics?.litres),
      cost: numericCount(metrics?.cost),
      flagged: numericCount(metrics?.flagged),
    },
    filters: { search, paymentMethod, anomalyState },
  };
}

export default async function FuelPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const session = await getServerSession();

  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fuel' }]} />
        <PageHeader title="Fuel Records" description="Track fuel transactions and monitor consumption" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view fuel records." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fuel' }]} />
        <PageHeader title="Fuel Records" description="Track fuel transactions and monitor consumption" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/fuel', roleNames);
  const canCreate = canPerformDashboardAction('/dashboard/fuel/new', roleNames, 'create');
  let result: Awaited<ReturnType<typeof fetchFuelEntries>>;
  try {
    result = await fetchFuelEntries(sp, session.tenantId, session.user.id, access.recordScope);
  } catch (error) {
    console.error('Fuel query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fuel' }]} />
        <PageHeader title="Fuel Records" description="Track fuel transactions and monitor consumption" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Fuel Records" />
      </div>
    );
  }

  const metrics = [
    { label: 'Transactions', value: result.metrics.total.toLocaleString(), tone: 'text-ink-950' },
    { label: 'Total Volume', value: `${result.metrics.litres.toFixed(1)} L`, tone: 'text-ink-950' },
    { label: 'Total Cost', value: formatCurrency(result.metrics.cost), tone: 'text-ink-950' },
    { label: 'Flagged', value: result.metrics.flagged.toLocaleString(), tone: result.metrics.flagged > 0 ? 'text-status-error-text' : 'text-ink-950' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fuel' }]} />
      <PageHeader title="Fuel Records" description="Fuel transactions, receipt evidence and anomaly monitoring">
        {canCreate && (
          <Button variant="primary" size="sm" asChild>
            <Link href="/dashboard/fuel/new"><Plus className="h-4 w-4" aria-hidden="true" /> New Entry</Link>
          </Button>
        )}
      </PageHeader>

      {sp.warning === 'reimbursement_pending' && (
        <div className="border-status-warning-text/20 bg-status-warning-bg text-status-warning-text rounded-[8px] border px-4 py-3 text-sm" role="alert">
          Fuel transaction saved, but reimbursement could not be auto-created. Link the employee account or ask the responsible finance team to process it manually.
        </div>
      )}

      <section aria-label="Fuel summary" className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border lg:grid-cols-4">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-surface px-4 py-4 sm:px-5">
            <p className={`text-xl font-semibold tabular-nums sm:text-2xl ${metric.tone}`}>{metric.value}</p>
            <p className="text-ink-500 mt-0.5 text-xs">{metric.label}</p>
          </div>
        ))}
      </section>

      <Card>
        <CardContent className="pt-4">
          <FilterToolbar resetHref="/dashboard/fuel" isFiltered={hasActiveFilters(result.filters)}>
            <div className="min-w-[200px] flex-1">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
              <LiveSearchInput name="search" defaultValue={result.filters.search ?? ''} placeholder="GRN, station, reference…" />
            </div>
            <div className="w-full sm:w-[190px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Payment Method</label>
              <StyledSelect name="payment_method" defaultValue={result.filters.paymentMethod ?? ''} placeholder="All Methods">
                <option value="fuel_card">Fuel Card</option>
                <option value="cash">Cash</option>
                <option value="personal_reimbursement">Personal Reimbursement</option>
              </StyledSelect>
            </div>
            <div className="w-full sm:w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Anomaly</label>
              <StyledSelect name="anomaly_state" defaultValue={result.filters.anomalyState ?? ''} placeholder="All States">
                <option value="none">Normal</option>
                <option value="flagged">Flagged</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Fuel className="h-8 w-8" />}
          title="No fuel records found"
          description={hasActiveFilters(result.filters) ? 'No matching records found. Clear filters to view all records.' : 'No fuel transactions recorded yet.'}
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {result.rows.map((entry) => (
            <Link key={entry.id} href={`/dashboard/fuel/${entry.id}`} className="focus-ring border-border group block border-b p-4 transition-colors last:border-b-0 hover:bg-muted/40 motion-reduce:transition-none sm:p-5">
              <div className="flex items-start gap-3 sm:gap-4">
                <div className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-[8px] sm:flex ${entry.anomalyState !== 'none' ? 'bg-status-error-bg text-status-error-text' : 'bg-brand-50 text-brand-700'}`}>
                  <Fuel className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ink-950 text-sm font-semibold">{entry.make} {entry.model}</p>
                    <Badge variant={entry.paymentMethod === 'personal_reimbursement' ? 'pending' : entry.paymentMethod === 'fuel_card' ? 'info' : 'default'} size="sm">
                      {entry.paymentMethod.replace(/_/g, ' ')}
                    </Badge>
                    {entry.anomalyState !== 'none' && <Badge variant="error" size="sm">{entry.anomalyState}</Badge>}
                  </div>
                  <div className="text-ink-500 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="tabular-nums">{entry.licenceNumber}</span>
                    <span>{entry.stationName || 'Unknown station'}</span>
                    <span className="tabular-nums">{formatDate(entry.transactionAt)}</span>
                    {entry.driverName && <span>Driver: {entry.driverName}</span>}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-ink-950 text-sm font-semibold tabular-nums">{Number(entry.litres).toFixed(1)} L</p>
                  <p className="text-ink-500 mt-0.5 text-xs tabular-nums">{formatCurrency(Number(entry.amount))}</p>
                  <ChevronRight className="text-ink-300 group-hover:text-brand-700 ml-auto mt-2 h-4 w-4" aria-hidden="true" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink-500 text-xs">Page {result.page} of {result.totalPages} ({result.totalCount} entries)</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/fuel', sp, { page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" aria-hidden="true" /> Previous</Link></Button>}
            {result.page < result.totalPages && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/fuel', sp, { page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" aria-hidden="true" /></Link></Button>}
          </div>
        </div>
      )}
    </div>
  );
}
