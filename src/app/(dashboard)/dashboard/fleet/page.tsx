import { getDb, isDbConnected } from '@/db';
import { vehicles, vehicleCategories, vehicleDefects, maintenanceEvents } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import { eq, and, sql, like, or, isNull, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { getServerSession } from '@/lib/session';
import {
  Truck,
  Search,
  ChevronRight,
  ChevronLeft,
  Car,
  AlertTriangle,
  Wrench,
  Gauge,
  Upload,
} from 'lucide-react';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const VEHICLE_STATUS_VARIANTS: Record<
  string,
  'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'
> = {
  available: 'success',
  provisional: 'pending',
  allocated: 'info',
  issued: 'info',
  maintenance: 'pending',
  out_of_service: 'error',
  written_off: 'cancelled',
};

const VEHICLE_STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  provisional: 'Provisional',
  allocated: 'Allocated',
  issued: 'Issued',
  maintenance: 'In Maintenance',
  out_of_service: 'Out of Service',
  written_off: 'Written Off',
};

function buildPageUrl(base: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

async function fetchFleetData(sp: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = sp.search?.trim();
  const status = sp.status?.trim();
  const categoryId = sp.category_id?.trim();
  const officeId = sp.office_id?.trim();

  const conditions: SQL[] = [eq(vehicles.isActive, true), eq(vehicles.tenantId, tenantId)];

  if (status) {
    conditions.push(eq(vehicles.status, status));
  }
  if (categoryId) {
    conditions.push(eq(vehicles.categoryId, categoryId));
  }
  if (officeId) {
    conditions.push(eq(vehicles.officeId, officeId));
  }
  if (search) {      conditions.push(
        or(
          like(vehicles.licenceNumber, `%${search}%`),
          like(vehicles.vehicleRegisterNumber, `%${search}%`),
          like(vehicles.make, `%${search}%`),
          like(vehicles.model, `%${search}%`),
          like(vehicles.vin, `%${search}%`),
          like(vehicles.engineNumber, `%${search}%`),
        )!,
      );
  }

  const where = and(...conditions);

  const [rows, totalResult, categories, allOffices] = await Promise.all([
    db
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        make: vehicles.make,
        model: vehicles.model,
        manufactureYear: vehicles.manufactureYear,
        colour: vehicles.colour,
        fuelType: vehicles.fuelType,
        transmission: vehicles.transmission,
        vin: vehicles.vin,
        engineNumber: vehicles.engineNumber,
        currentOdometer: vehicles.currentOdometer,
        status: vehicles.status,
        categoryId: vehicles.categoryId,
        categoryName: vehicleCategories.name,
        officeName: offices.name,
      })
      .from(vehicles)
      .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
      .leftJoin(offices, eq(vehicles.officeId, offices.id))
      .where(where)
      .orderBy(vehicles.licenceNumber)
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(vehicles)
      .where(where),
    db
      .select({ id: vehicleCategories.id, name: vehicleCategories.name })
      .from(vehicleCategories)
      .where(eq(vehicleCategories.isActive, true))
      .orderBy(vehicleCategories.name),
    db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(eq(offices.isActive, true))
      .orderBy(offices.name),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);

  // Fetch defect and maintenance counts per vehicle
  const vehicleIds = rows.map((r) => r.id);
  const [defectCounts, maintenanceCounts] = await Promise.all([
    vehicleIds.length > 0
      ? db
          .select({
            vehicleId: vehicleDefects.vehicleId,
            count: sql<number>`count(*)`,
          })
          .from(vehicleDefects)
          .where(and(isNull(vehicleDefects.resolvedAt)))
          .groupBy(vehicleDefects.vehicleId)
      : Promise.resolve([]),
    vehicleIds.length > 0
      ? db
          .select({
            vehicleId: maintenanceEvents.vehicleId,
            count: sql<number>`count(*)`,
          })
          .from(maintenanceEvents)
          .groupBy(maintenanceEvents.vehicleId)
      : Promise.resolve([]),
  ]);

  const defectMap = new Map(defectCounts.map((r) => [r.vehicleId, r.count]));
  const maintenanceMap = new Map(maintenanceCounts.map((r) => [r.vehicleId, r.count]));

  return {
    rows,
    totalCount,
    totalPages,
    page,
    categories,
    allOffices,
    defectMap,
    maintenanceMap,
    filters: { search, status, categoryId, officeId },
  };
}

export default async function FleetPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet' }]} />
        <PageHeader title="Fleet" description="Manage vehicles, view status, defects and maintenance" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view fleet data." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet' }]} />
        <PageHeader title="Fleet" description="Manage vehicles, view status, defects and maintenance" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations to enable the fleet module."
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchFleetData>>;
  try {
    result = await fetchFleetData(sp, session.tenantId);
  } catch (error) {
    console.error('Fleet query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet' }]} />
        <PageHeader title="Fleet" description="Manage vehicles, view status, defects and maintenance" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Fleet Data"
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
          { label: 'Fleet' },
        ]}
      />
      <PageHeader
        title="Fleet"
        description="Manage vehicles, view status, defects and maintenance"
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fleet/defects">
            <AlertTriangle className="h-4 w-4" />
            Defects
          </Link>
        </Button>
        <Button variant="tertiary" size="sm" asChild>
          <Link href="/dashboard/fleet/import">
            <Upload className="h-4 w-4" />
            Import
          </Link>
        </Button>
      </PageHeader>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  name="search"
                  defaultValue={result.filters.search ?? ''}
                  placeholder="Licence, VIN, make, model..."
                  className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200"
                />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">
                Status
              </label>
              <select
                name="status"
                defaultValue={result.filters.status ?? ''}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">All Statuses</option>
                {Object.entries(VEHICLE_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">
                Category
              </label>
              <select
                name="category_id"
                defaultValue={result.filters.categoryId ?? ''}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">All Categories</option>
                {result.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">
                Office
              </label>
              <select
                name="office_id"
                defaultValue={result.filters.officeId ?? ''}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">All Offices</option>
                {result.allOffices.map((off) => (
                  <option key={off.id} value={off.id}>
                    {off.name}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit">
              <Search className="h-4 w-4" />
              Filter
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Fleet Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-success-text">
                {result.rows.filter((r) => r.status === 'available').length}
              </p>
              <p className="text-xs text-ink-500">Available</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-ink-950">
                {result.rows.filter((r) => r.status === 'issued' || r.status === 'allocated').length}
              </p>
              <p className="text-xs text-ink-500">On Trip / Allocated</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-pending-text">
                {result.rows.filter((r) => r.status === 'maintenance').length}
              </p>
              <p className="text-xs text-ink-500">In Maintenance</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-error-text">
                {result.rows.filter((r) => r.status === 'out_of_service').length}
              </p>
              <p className="text-xs text-ink-500">Out of Service</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Vehicle List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="No vehicles found"
          description={result.filters.search ? 'Try adjusting your search criteria.' : 'No vehicles have been registered yet.'}
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((vehicle) => {
            const openDefects = result.defectMap.get(vehicle.id) ?? 0;
            const upcomingMaintenance = result.maintenanceMap.get(vehicle.id) ?? 0;
            const statusVariant = VEHICLE_STATUS_VARIANTS[vehicle.status] ?? 'default';

            return (
              <Link
                key={vehicle.id}
                href={`/dashboard/fleet/${vehicle.id}`}
                className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                      <Car className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-[650] text-ink-950">
                          {vehicle.make} {vehicle.model}
                        </p>
                        {vehicle.manufactureYear && (
                          <span className="text-xs text-ink-500">({vehicle.manufactureYear})</span>
                        )}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        <span className="tabular-nums">{vehicle.licenceNumber}</span>
                        {vehicle.vehicleRegisterNumber && (
                          <span>{vehicle.vehicleRegisterNumber}</span>
                        )}
                        {vehicle.colour && <span>{vehicle.colour}</span>}
                        {vehicle.categoryName && <span>{vehicle.categoryName}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="hidden sm:flex items-center gap-3 text-xs text-ink-500">
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3.5 w-3.5" />
                        {vehicle.currentOdometer.toLocaleString()} km
                      </span>
                      {openDefects > 0 && (
                        <span className="flex items-center gap-1 text-status-error-text">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {openDefects} defect{openDefects !== 1 ? 's' : ''}
                        </span>
                      )}
                      {upcomingMaintenance > 0 && (
                        <span className="flex items-center gap-1 text-status-pending-text">
                          <Wrench className="h-3.5 w-3.5" />
                          {upcomingMaintenance} pending
                        </span>
                      )}
                    </div>
                    <Badge variant={statusVariant}>
                      {VEHICLE_STATUS_LABELS[vehicle.status] ?? vehicle.status}
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-ink-300" />
                  </div>
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
            Page {result.page} of {result.totalPages} ({result.totalCount} vehicles)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildPageUrl('/dashboard/fleet', {
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
                  href={buildPageUrl('/dashboard/fleet', {
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
