import { getDb, isDbConnected } from '@/db';
import { maintenanceEvents, vehicles } from '@/db/schema/fleet';
import { eq, desc, and, sql, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate, formatCurrency } from '@/lib/utils';
import {
  Wrench,
  ChevronLeft,
  ChevronRight,
  Search,
  Car,
  Gauge,
  CalendarClock,
  DollarSign,
  Download,
} from 'lucide-react';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

async function fetchMaintenance(sp: Record<string, string | undefined>) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const serviceType = sp.service_type?.trim();

  const conditions: SQL[] = [];

  if (serviceType) {
    conditions.push(eq(maintenanceEvents.serviceType, serviceType));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
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
      .where(where),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);

  const totalCost = rows.reduce((sum, r) => sum + (r.cost ? Number(r.cost) : 0), 0);
  const upcomingServices = rows.filter(
    (r) => r.nextServiceDate && new Date(r.nextServiceDate) > new Date(),
  ).length;

  return {
    rows,
    totalCount,
    totalPages,
    page,
    totalCost,
    upcomingServices,
    filters: { serviceType },
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

const SERVICE_TYPE_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  repair: 'Repair',
  inspection: 'Inspection',
};

export default async function MaintenancePage({ searchParams }: PageProps) {
  const sp = await searchParams;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Maintenance' },
        ]} />
        <PageHeader title="Maintenance" description="Vehicle service and repair history across the fleet" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations."
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchMaintenance>>;
  try {
    result = await fetchMaintenance(sp);
  } catch (error) {
    console.error('Maintenance query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Maintenance' },
        ]} />
        <PageHeader title="Maintenance" description="Vehicle service and repair history across the fleet" />
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
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Maintenance' },
        ]}
      />
      <PageHeader
        title="Maintenance"
        description="Vehicle service and repair history across the fleet"
      >
        <Button variant="primary" size="sm" asChild>
          <Link href="/dashboard/maintenance/new">
            <Wrench className="h-4 w-4" />
            Schedule Maintenance
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fleet">
            <Car className="h-4 w-4" />
            View Fleet
          </Link>
        </Button>
        <Button variant="tertiary" size="sm" asChild>
          <a href="/api/reports?type=maintenance&export=csv&period=90d">
            <Download className="h-4 w-4" />
            Export CSV
          </a>
        </Button>
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-ink-950">
                {result.totalCount}
              </p>
              <p className="text-xs text-ink-500">Total Events</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-ink-950">
                {formatCurrency(result.totalCost)}
              </p>
              <p className="text-xs text-ink-500">Total Cost</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-pending-text">
                {result.upcomingServices}
              </p>
              <p className="text-xs text-ink-500">Upcoming Services</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-info-text">
                {result.rows.filter((r) => r.serviceType === 'scheduled').length}
              </p>
              <p className="text-xs text-ink-500">Scheduled Services</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4">
            <div className="w-[200px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">
                Service Type
              </label>
              <select
                name="service_type"
                defaultValue={result.filters.serviceType ?? ''}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">All Types</option>
                <option value="scheduled">Scheduled</option>
                <option value="repair">Repair</option>
                <option value="inspection">Inspection</option>
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit">
              <Search className="h-4 w-4" />
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Maintenance List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Wrench className="h-8 w-8" />}
          title="No maintenance events"
          description="There are no maintenance events matching the current filters."
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((event) => (
            <div
              key={event.id}
              className="rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-status-info-bg text-status-info-text">
                      <Wrench className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink-950">
                        {event.description}
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
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
                    <p className="mt-2 text-xs text-ink-500 ml-10">
                      Vendor: {event.vendorName}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge variant="info" size="sm">
                    {SERVICE_TYPE_LABELS[event.serviceType] ?? event.serviceType}
                  </Badge>
                  {event.cost && Number(event.cost) > 0 && (
                    <span className="flex items-center gap-1 text-xs font-medium text-ink-950">
                      <DollarSign className="h-3 w-3" />
                      {formatCurrency(Number(event.cost))}
                    </span>
                  )}
                  {event.nextServiceDate && (
                    <span className="text-[11px] text-ink-500">
                      Next: {formatDate(event.nextServiceDate)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-ink-500">
            Page {result.page} of {result.totalPages} ({result.totalCount} events)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildPageUrl('/dashboard/maintenance', {
                    ...sp,
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
                  href={buildPageUrl('/dashboard/maintenance', {
                    ...sp,
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
