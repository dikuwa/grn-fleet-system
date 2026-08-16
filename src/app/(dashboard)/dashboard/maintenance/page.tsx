import { getDb, isDbConnected } from '@/db';
import { maintenanceEvents, vehicles } from '@/db/schema/fleet';
import { eq, desc, and, sql, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StyledSelect } from '@/components/ui/styled-select';
import { EmptyState } from '@/components/ui/empty-state';
import { Database } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate, formatCurrency } from '@/lib/utils';
import {
  Wrench,
  ChevronLeft,
  ChevronRight,
  Car,
  Gauge,
  CalendarClock,
  DollarSign,
  Download,
} from 'lucide-react';
import Link from 'next/link';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import {
  canAccessDashboardPath,
  canPerformDashboardAction,
  resolveDashboardAccess,
  type DashboardRecordScope,
} from '@/lib/dashboard-access';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { numericCount } from '@/lib/statistics';
import { maintenanceScopeCondition } from '@/lib/record-scope';
import { daysUntilNamibiaDate } from '@/lib/maintenance-record-validation';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

async function fetchMaintenance(
  sp: Record<string, string | undefined>,
  tenantId: string,
  userId: string,
  recordScope: DashboardRecordScope,
) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const serviceType = normalizeOptionalFilter(sp.service_type);
  const due = normalizeOptionalFilter(sp.due);

  const baseConditions: SQL[] = [
    eq(vehicles.tenantId, tenantId),
    maintenanceScopeCondition({ tenantId, userId, recordScope }),
  ];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (serviceType) {
    conditions.push(eq(maintenanceEvents.serviceType, serviceType));
  }
  if (due === 'soon') {
    conditions.push(
      sql`${maintenanceEvents.nextServiceDate} >= current_date and ${maintenanceEvents.nextServiceDate} <= current_date + interval '7 days'`,
    );
  } else if (due === 'overdue') {
    conditions.push(sql`${maintenanceEvents.nextServiceDate} < current_date`);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult, metricResult] = await Promise.all([
    db
      .select({
        id: maintenanceEvents.id,
        serviceDate: maintenanceEvents.serviceDate,
        serviceOdometer: maintenanceEvents.serviceOdometer,
        serviceType: maintenanceEvents.serviceType,
        description: maintenanceEvents.description,
        cost: maintenanceEvents.cost,
        vendorName: maintenanceEvents.vendorName,
        nextServiceDate: maintenanceEvents.nextServiceDate,
        nextServiceOdometer: maintenanceEvents.nextServiceOdometer,
        createdAt: maintenanceEvents.createdAt,
        vehicleId: maintenanceEvents.vehicleId,
        vehicleGrn: vehicles.licenceNumber,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
      })
      .from(maintenanceEvents)
      .leftJoin(vehicles, eq(maintenanceEvents.vehicleId, vehicles.id))
      .where(where)
      .orderBy(desc(maintenanceEvents.serviceDate))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(maintenanceEvents)
      .innerJoin(vehicles, eq(maintenanceEvents.vehicleId, vehicles.id))
      .where(where),
    db
      .select({
        total: sql<number>`count(*)`,
        cost: sql<string>`coalesce(sum(${maintenanceEvents.cost}), 0)`,
        upcoming: sql<number>`count(*) filter (where ${maintenanceEvents.nextServiceDate} > current_date)`,
        dueSoon: sql<number>`count(*) filter (where ${maintenanceEvents.nextServiceDate} >= current_date and ${maintenanceEvents.nextServiceDate} <= current_date + interval '7 days')`,
        overdue: sql<number>`count(*) filter (where ${maintenanceEvents.nextServiceDate} < current_date)`,
        scheduled: sql<number>`count(*) filter (where ${maintenanceEvents.serviceType} = 'scheduled')`,
      })
      .from(maintenanceEvents)
      .innerJoin(vehicles, eq(maintenanceEvents.vehicleId, vehicles.id))
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
      cost: numericCount(metrics?.cost),
      upcoming: numericCount(metrics?.upcoming),
      dueSoon: numericCount(metrics?.dueSoon),
      overdue: numericCount(metrics?.overdue),
      scheduled: numericCount(metrics?.scheduled),
    },
    filters: { serviceType, due },
  };
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  scheduled: 'Routine Service',
  repair: 'Repair',
  inspection: 'Inspection',
};

export default async function MaintenancePage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const session = await getServerSession();
  if (!session) return null;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Maintenance' }]}
        />
        <PageHeader
          title="Maintenance"
          description="Vehicle service and repair history across the fleet"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations."
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchMaintenance>>;
  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/maintenance', roleNames);
  const canCreate = canPerformDashboardAction('/dashboard/maintenance/new', roleNames, 'create');
  const canExport = canPerformDashboardAction('/dashboard/maintenance', roleNames, 'export');
  const canViewFleet = canAccessDashboardPath('/dashboard/fleet', roleNames);
  try {
    result = await fetchMaintenance(
      sp,
      session.tenantId,
      session.user.id,
      access.recordScope ?? 'assigned',
    );
  } catch (error) {
    console.error('Maintenance query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Maintenance' }]}
        />
        <PageHeader
          title="Maintenance"
          description="Vehicle service and repair history across the fleet"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Maintenance Data"
          description="The database query failed. Please run migrations and seed first."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Maintenance' }]} />
      <PageHeader
        title="Maintenance"
        description="Vehicle service and repair history across the fleet"
      >
        {canCreate && (
          <Button variant="primary" size="sm" asChild>
            <Link href="/dashboard/maintenance/new">
              <Wrench className="h-4 w-4" />
              Record Maintenance
            </Link>
          </Button>
        )}
        {canViewFleet && (
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/fleet">
              <Car className="h-4 w-4" />
              View Fleet
            </Link>
          </Button>
        )}
        {canExport && (
          <Button variant="tertiary" size="sm" asChild>
            <a href="/api/reports?type=maintenance&export=csv&period=90d">
              <Download className="h-4 w-4" />
              Export CSV
            </a>
          </Button>
        )}
      </PageHeader>

      {/* Next-service reminder tabs */}
      {result.metrics.overdue > 0 || result.metrics.dueSoon > 0 ? (
        <div className="flex flex-wrap gap-2">
          <Link
            href={buildFilterUrl('/dashboard/maintenance', sp, { due: undefined, page: undefined })}
            className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
              !result.filters.due
                ? 'bg-brand-50 text-brand-700'
                : 'bg-surface text-ink-500 hover:text-ink-700'
            }`}
          >
            All
          </Link>
          {result.metrics.dueSoon > 0 && (
            <Link
              href={buildFilterUrl('/dashboard/maintenance', sp, { due: 'soon', page: undefined })}
              className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                result.filters.due === 'soon'
                  ? 'bg-status-warning-bg text-status-warning-text'
                  : 'bg-surface text-ink-500 hover:text-ink-700'
              }`}
            >
              Reminder Due Soon ({result.metrics.dueSoon})
            </Link>
          )}
          {result.metrics.overdue > 0 && (
            <Link
              href={buildFilterUrl('/dashboard/maintenance', sp, {
                due: 'overdue',
                page: undefined,
              })}
              className={`inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
                result.filters.due === 'overdue'
                  ? 'bg-status-error-bg text-status-error-text'
                  : 'bg-surface text-ink-500 hover:text-ink-700'
              }`}
            >
              Reminder Overdue ({result.metrics.overdue})
            </Link>
          )}
        </div>
      ) : null}

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-ink-950 text-2xl font-[650] tabular-nums">
                {result.metrics.total}
              </p>
              <p className="text-ink-500 text-xs">Total Events</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-ink-950 text-2xl font-[650] tabular-nums">
                {formatCurrency(result.metrics.cost)}
              </p>
              <p className="text-ink-500 text-xs">Total Cost</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-status-pending-text text-2xl font-[650] tabular-nums">
                {result.metrics.upcoming}
              </p>
              <p className="text-ink-500 text-xs">Upcoming Service Reminders</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-status-info-text text-2xl font-[650] tabular-nums">
                {result.metrics.scheduled}
              </p>
              <p className="text-ink-500 text-xs">Routine Service Records</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar
            resetHref="/dashboard/maintenance"
            isFiltered={hasActiveFilters(result.filters)}
          >
            <div className="w-[200px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Service Type</label>
              <StyledSelect
                name="service_type"
                defaultValue={result.filters.serviceType ?? ''}
                placeholder="All Types"
              >
                <option value="scheduled">Routine Service</option>
                <option value="repair">Repair</option>
                <option value="inspection">Inspection</option>
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Derive display rows from active filter */}
      {(() => {
        const displayRows = result.rows;

        return displayRows.length === 0 ? (
          <EmptyState
            icon={<Wrench className="h-8 w-8" />}
            title="No maintenance events"
            description="There are no maintenance events matching the current filters."
          />
        ) : (
          <div className="space-y-3">
            {displayRows.map((event) => (
              <div
                key={event.id}
                className="border-border bg-surface hover:border-brand-100 rounded-[10px] border p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <div className="bg-status-info-bg text-status-info-text flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px]">
                        <Wrench className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="text-ink-950 text-sm font-medium">{event.description}</p>
                        <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                          <span className="flex items-center gap-1">
                            <Car className="h-3 w-3" />
                            {event.vehicleMake} {event.vehicleModel} ({event.vehicleGrn})
                          </span>
                          <span className="flex items-center gap-1">
                            <CalendarClock className="h-3 w-3" />
                            {formatDate(event.serviceDate)}
                          </span>
                          {event.serviceOdometer && (
                            <span className="flex items-center gap-1">
                              <Gauge className="h-3 w-3" />
                              {event.serviceOdometer.toLocaleString()} km
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {event.vendorName && (
                      <p className="text-ink-500 mt-2 ml-10 text-xs">Vendor: {event.vendorName}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <Badge variant="info" size="sm">
                      {SERVICE_TYPE_LABELS[event.serviceType] ?? event.serviceType}
                    </Badge>
                    {event.cost && Number(event.cost) > 0 && (
                      <span className="text-ink-950 flex items-center gap-1 text-xs font-medium">
                        <DollarSign className="h-3 w-3" />
                        {formatCurrency(Number(event.cost))}
                      </span>
                    )}
                    {event.nextServiceDate &&
                      (() => {
                        const daysUntil = daysUntilNamibiaDate(event.nextServiceDate);
                        if (daysUntil < 0) {
                          return (
                            <Badge variant="error" size="sm">
                              Reminder overdue {Math.abs(daysUntil)}d
                            </Badge>
                          );
                        }
                        if (daysUntil <= 7) {
                          return (
                            <Badge variant="emergency" size="sm">
                              Reminder due in {daysUntil}d
                            </Badge>
                          );
                        }
                        return (
                          <span className="text-ink-500 text-[11px]">
                            Next service reminder: {formatDate(event.nextServiceDate)}
                          </span>
                        );
                      })()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="border-border flex items-center justify-between border-t pt-4">
          <p className="text-ink-500 text-xs">
            Page {result.page} of {result.totalPages} ({result.totalCount} events)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/maintenance', sp, {
                    page: String(result.page - 1),
                  })}
                >
                  <ChevronLeft className="h-3 w-3" />
                  Previous
                </Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/maintenance', sp, {
                    page: String(result.page + 1),
                  })}
                >
                  Next
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}