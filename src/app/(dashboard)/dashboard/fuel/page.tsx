import { getDb, isDbConnected } from '@/db';
import { fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq, desc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import { Database, Fuel, Search, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate, formatCurrency } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';
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

  if (paymentMethod) {
    conditions.push(eq(fuelTransactions.paymentMethod, paymentMethod));
  }
  if (anomalyState) {
    conditions.push(eq(fuelTransactions.anomalyState, anomalyState));
  }
  if (search) {
    conditions.push(
      or(
        like(vehicles.licenceNumber, `%${search}%`),
        like(vehicles.make, `%${search}%`),
        like(fuelTransactions.stationName, `%${search}%`),
        like(fuelTransactions.referenceNumber, `%${search}%`),
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
        <PageHeader
          title="Fuel Records"
          description="Track fuel transactions and monitor consumption"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Authentication Required"
          description="Please sign in to view fuel records."
        />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fuel' }]} />
        <PageHeader
          title="Fuel Records"
          description="Track fuel transactions and monitor consumption"
        />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchFuelEntries>>;
  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/fuel', roleNames);
  const canCreate = canPerformDashboardAction('/dashboard/fuel/new', roleNames, 'create');
  try {
    result = await fetchFuelEntries(sp, session.tenantId, session.user.id, access.recordScope);
  } catch (error) {
    console.error('Fuel query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fuel' }]} />
        <PageHeader
          title="Fuel Records"
          description="Track fuel transactions and monitor consumption"
        />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Fuel Records" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fuel' }]} />
      <PageHeader
        title="Fuel Records"
        description="Track fuel transactions and monitor consumption"
      >
        {canCreate && (
          <Button variant="primary" size="sm" asChild>
            <Link href="/dashboard/fuel/new">
              <Plus className="h-4 w-4" /> New Entry
            </Link>
          </Button>
        )}
      </PageHeader>

      {sp.warning === 'reimbursement_pending' && (
        <div className="flex items-center gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800/40 dark:bg-amber-950/20 dark:text-amber-300">
          Fuel transaction saved but reimbursement could not be auto-created. Please link your
          employee account or contact finance to manually process the reimbursement.
        </div>
      )}

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">{result.metrics.total}</p>
            <p className="text-ink-500 text-xs">Transactions</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">
              {result.metrics.litres.toFixed(1)} L
            </p>
            <p className="text-ink-500 text-xs">Total Volume</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">
              {formatCurrency(result.metrics.cost)}
            </p>
            <p className="text-ink-500 text-xs">Total Cost</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p
              className={`text-2xl font-[650] tabular-nums ${result.metrics.flagged > 0 ? 'text-status-error-text' : 'text-ink-950'}`}
            >
              {result.metrics.flagged}
            </p>
            <p className="text-ink-500 text-xs">Flagged</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar resetHref="/dashboard/fuel" isFiltered={hasActiveFilters(result.filters)}>
            <div className="min-w-[200px] flex-1">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
              <div className="relative">
                <Search className="text-ink-400 absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  name="search"
                  defaultValue={result.filters.search ?? ''}
                  placeholder="GRN, station, reference..."
                  className="border-border bg-surface text-ink-950 placeholder:text-ink-400 focus:ring-brand-600 h-10 w-full rounded-[8px] border pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
                />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Payment Method</label>
              <StyledSelect
                name="payment_method"
                defaultValue={result.filters.paymentMethod ?? ''}
                placeholder="All Methods"
              >
                <option value="fuel_card">Fuel Card</option>
                <option value="cash">Cash</option>
                <option value="personal_reimbursement">Personal Reimbursement</option>
              </StyledSelect>
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Anomaly</label>
              <StyledSelect
                name="anomaly_state"
                defaultValue={result.filters.anomalyState ?? ''}
                placeholder="All States"
              >
                <option value="none">Normal</option>
                <option value="flagged">Flagged</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Fuel List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Fuel className="h-8 w-8" />}
          title="No fuel records found"
          description={
            hasActiveFilters(result.filters)
              ? 'No matching records found. Clear filters to view all records.'
              : 'No fuel transactions recorded yet.'
          }
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((entry) => (
            <Link
              key={entry.id}
              href={`/dashboard/fuel/${entry.id}`}
              className="border-border bg-surface hover:border-brand-100 block rounded-[10px] border p-4 transition-all hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${entry.anomalyState !== 'none' ? 'bg-status-error-bg text-status-error-text' : 'bg-brand-50 text-brand-700'}`}
                  >
                    <Fuel className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-ink-950 text-sm font-[650]">
                        {entry.make} {entry.model}
                      </p>
                      <Badge
                        variant={
                          entry.paymentMethod === 'personal_reimbursement'
                            ? 'pending'
                            : entry.paymentMethod === 'fuel_card'
                              ? 'info'
                              : 'default'
                        }
                        size="sm"
                      >
                        {entry.paymentMethod.replace(/_/g, ' ')}
                      </Badge>
                      {entry.anomalyState !== 'none' && (
                        <Badge variant="error" size="sm">
                          {entry.anomalyState}
                        </Badge>
                      )}
                    </div>
                    <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="tabular-nums">{entry.licenceNumber}</span>
                      <span>{entry.stationName || 'Unknown station'}</span>
                      <span>{formatDate(entry.transactionAt)}</span>
                      {entry.driverName && (
                        <span>Driver: {entry.driverName}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-ink-950 text-sm font-[650] tabular-nums">
                    {Number(entry.litres).toFixed(1)} L
                  </p>
                  <p className="text-ink-500 text-xs tabular-nums">
                    {formatCurrency(Number(entry.amount))}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="border-border flex items-center justify-between border-t pt-4">
          <p className="text-ink-500 text-xs">
            Page {result.page} of {result.totalPages} ({result.totalCount} entries)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/fuel', sp, { page: String(result.page - 1) })}
                >
                  <ChevronLeft className="h-3 w-3" /> Previous
                </Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/fuel', sp, { page: String(result.page + 1) })}
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
