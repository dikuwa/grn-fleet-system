import { getDb, isDbConnected } from '@/db';
import { vehicles, vehicleCategories, vehicleDefects, maintenanceEvents } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import { eq, and, sql, like, or, isNull, inArray, type SQL } from 'drizzle-orm';
import { StyledSelect } from '@/components/ui/styled-select';
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
  ChevronRight,
  ChevronLeft,
  Car,
  AlertTriangle,
  Wrench,
  Gauge,
  Upload,
  Download,
} from 'lucide-react';
import Link from 'next/link';
import { LiveSearchInput } from '@/components/ui/live-search-input';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import {
  canAccessDashboardPath,
  canPerformDashboardAction,
  resolveDashboardAccess,
} from '@/lib/dashboard-access';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap, sumGroupedCounts } from '@/lib/statistics';
import { vehicleScopeCondition } from '@/lib/record-scope';
import type { DashboardRecordScope } from '@/lib/dashboard-access';

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

async function fetchFleetData(
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
  const categoryId = normalizeOptionalFilter(sp.category_id);
  const officeId = normalizeOptionalFilter(sp.office_id);

  const baseConditions: SQL[] = [
    eq(vehicles.isActive, true),
    vehicleScopeCondition({ tenantId, userId, recordScope }),
  ];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (status) {
    conditions.push(eq(vehicles.status, status));
  }
  if (categoryId) {
    conditions.push(eq(vehicles.categoryId, categoryId));
  }
  if (officeId) {
    conditions.push(eq(vehicles.officeId, officeId));
  }
  if (search) {
    conditions.push(
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

  const [rows, totalResult, categories, allOffices, statusCounts] = await Promise.all([
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
      .where(and(eq(vehicleCategories.tenantId, tenantId), eq(vehicleCategories.isActive, true)))
      .orderBy(vehicleCategories.name),
    db
      .select({ id: offices.id, name: offices.name })
      .from(offices)
      .where(and(eq(offices.tenantId, tenantId), eq(offices.isActive, true)))
      .orderBy(offices.name),
    db
      .select({ key: vehicles.status, count: sql<number>`count(*)` })
      .from(vehicles)
      .where(baseWhere)
      .groupBy(vehicles.status),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const counts = groupedCountMap(statusCounts);

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
          .where(
            and(isNull(vehicleDefects.resolvedAt), inArray(vehicleDefects.vehicleId, vehicleIds)),
          )
          .groupBy(vehicleDefects.vehicleId)
      : Promise.resolve([]),
    vehicleIds.length > 0
      ? db
          .select({
            vehicleId: maintenanceEvents.vehicleId,
            count: sql<number>`count(*)`,
          })
          .from(maintenanceEvents)
          .where(inArray(maintenanceEvents.vehicleId, vehicleIds))
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
    metrics: {
      available: counts.get('available') ?? 0,
      allocated: sumGroupedCounts(counts, ['issued', 'allocated']),
      maintenance: counts.get('maintenance') ?? 0,
      outOfService: counts.get('out_of_service') ?? 0,
    },
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
        <PageHeader
          title="Fleet"
          description="Manage vehicles, view status, defects and maintenance"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Authentication Required"
          description="Please sign in to view fleet data."
        />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet' }]} />
        <PageHeader
          title="Fleet"
          description="Manage vehicles, view status, defects and maintenance"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations to enable the fleet module."
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchFleetData>>;
  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/fleet', roleNames);
  const canViewDefects = canAccessDashboardPath('/dashboard/fleet/defects', roleNames);
  const canImport = canPerformDashboardAction('/dashboard/fleet/import', roleNames, 'import');
  const canExport = canPerformDashboardAction('/dashboard/fleet', roleNames, 'export');
  const lookupOnly = access.recordScope !== 'tenant';
  try {
    result = await fetchFleetData(
      sp,
      session.tenantId,
      session.user.id,
      access.recordScope ?? 'assigned',
    );
  } catch (error) {
    console.error('Fleet query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet' }]} />
        <PageHeader
          title="Fleet"
          description="Manage vehicles, view status, defects and maintenance"
        />
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
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet' }]} />
      <PageHeader
        title={lookupOnly ? 'Vehicle Lookup' : 'Fleet'}
        description={
          lookupOnly
            ? 'View vehicles connected to your assigned work.'
            : 'Manage vehicles, view status, defects and maintenance'
        }
      >
        {canViewDefects && (
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/fleet/defects">
              <AlertTriangle className="h-4 w-4" />
              Defects
            </Link>
          </Button>
        )}
        {canImport && (
          <Button variant="tertiary" size="sm" asChild>
            <Link href="/dashboard/fleet/import">
              <Upload className="h-4 w-4" />
              Import
            </Link>
          </Button>
        )}
        {canExport && (
          <Button variant="tertiary" size="sm" asChild>
            <a href="/api/reports?type=fuel&export=csv&period=90d">
              <Download className="h-4 w-4" />
              Export CSV
            </a>
          </Button>
        )}
      </PageHeader>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar resetHref="/dashboard/fleet" isFiltered={hasActiveFilters(result.filters)}>
            <div className="min-w-[200px] flex-1">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Search</label>
              <LiveSearchInput
                name="search"
                defaultValue={result.filters.search ?? ''}
                placeholder={lookupOnly ? 'Licence, make or model…' : 'Licence, VIN, make, model…'}
              />
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
              <StyledSelect
                name="status"
                defaultValue={result.filters.status ?? ''}
                placeholder="All Statuses"
              >
                {Object.entries(VEHICLE_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Category</label>
              <StyledSelect
                name="category_id"
                defaultValue={result.filters.categoryId ?? ''}
                placeholder="All Categories"
              >
                {result.categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Office</label>
              <StyledSelect
                name="office_id"
                defaultValue={result.filters.officeId ?? ''}
                placeholder="All Offices"
              >
                {result.allOffices.map((off) => (
                  <option key={off.id} value={off.id}>
                    {off.name}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Fleet Summary */}
      {!lookupOnly && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Card>
            <CardContent className="pt-4">
              <div className="text-center">
                <p className="text-status-success-text text-2xl font-[650] tabular-nums">
                  {result.metrics.available}
                </p>
                <p className="text-ink-500 text-xs">Available</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-center">
                <p className="text-ink-950 text-2xl font-[650] tabular-nums">
                  {result.metrics.allocated}
                </p>
                <p className="text-ink-500 text-xs">On Trip / Allocated</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-center">
                <p className="text-status-pending-text text-2xl font-[650] tabular-nums">
                  {result.metrics.maintenance}
                </p>
                <p className="text-ink-500 text-xs">In Maintenance</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <div className="text-center">
                <p className="text-status-error-text text-2xl font-[650] tabular-nums">
                  {result.metrics.outOfService}
                </p>
                <p className="text-ink-500 text-xs">Out of Service</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Vehicle List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-8 w-8" />}
          title="No vehicles found"
          description={
            hasActiveFilters(result.filters)
              ? 'No matching records found. Clear filters to view all records.'
              : 'No vehicles have been registered yet.'
          }
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
                className="border-border bg-surface hover:border-brand-100 block rounded-[10px] border p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="bg-brand-50 text-brand-700 flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px]">
                      <Car className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-ink-950 text-sm font-[650]">
                          {vehicle.make} {vehicle.model}
                        </p>
                        {vehicle.manufactureYear && (
                          <span className="text-ink-500 text-xs">({vehicle.manufactureYear})</span>
                        )}
                      </div>
                      <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="tabular-nums">{vehicle.licenceNumber}</span>
                        {vehicle.vehicleRegisterNumber && (
                          <span>{vehicle.vehicleRegisterNumber}</span>
                        )}
                        {vehicle.colour && <span>{vehicle.colour}</span>}
                        {vehicle.categoryName && <span>{vehicle.categoryName}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-4">
                    <div className="text-ink-500 hidden items-center gap-3 text-xs sm:flex">
                      <span className="flex items-center gap-1">
                        <Gauge className="h-3.5 w-3.5" />
                        {vehicle.currentOdometer.toLocaleString()} km
                      </span>
                      {openDefects > 0 && (
                        <span className="text-status-error-text flex items-center gap-1">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {openDefects} defect{openDefects !== 1 ? 's' : ''}
                        </span>
                      )}
                      {upcomingMaintenance > 0 && (
                        <span className="text-status-pending-text flex items-center gap-1">
                          <Wrench className="h-3.5 w-3.5" />
                          {upcomingMaintenance} pending
                        </span>
                      )}
                    </div>
                    <Badge variant={statusVariant}>
                      {VEHICLE_STATUS_LABELS[vehicle.status] ?? vehicle.status}
                    </Badge>
                    <ChevronRight className="text-ink-300 h-4 w-4" />
                  </div>
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
            Page {result.page} of {result.totalPages} ({result.totalCount} vehicles)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/fleet', sp, {
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
                  href={buildFilterUrl('/dashboard/fleet', sp, {
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
