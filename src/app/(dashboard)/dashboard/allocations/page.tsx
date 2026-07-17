import { getDb, isDbConnected } from '@/db';
import { vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq, desc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Truck, Search, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const ALLOCATION_STATE_LABELS: Record<string, string> = {
  provisional: 'Provisional',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  released: 'Released',
};

const ALLOCATION_STATE_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  provisional: 'pending',
  confirmed: 'info',
  cancelled: 'cancelled',
  released: 'success',
};

async function fetchAllocations(sp: Record<string, string | undefined>) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = sp.search?.trim();
  const state = sp.state?.trim();

  const conditions: SQL[] = [];

  if (state) {
    conditions.push(eq(vehicleAllocations.state, state));
  }
  if (search) {
    conditions.push(
      or(
        like(vehicles.licenceNumber, `%${search}%`),
        like(vehicles.make, `%${search}%`),
        like(vehicles.model, `%${search}%`),
        like(transportRequests.reference, `%${search}%`),
      )!,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
        recommendationScore: vehicleAllocations.recommendationScore,
        overrideReason: vehicleAllocations.overrideReason,
        createdAt: vehicleAllocations.createdAt,
        vehicleId: vehicleAllocations.vehicleId,
        requestId: vehicleAllocations.requestId,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        requestReference: transportRequests.reference,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
      })
      .from(vehicleAllocations)
      .leftJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .leftJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(where)
      .orderBy(desc(vehicleAllocations.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(vehicleAllocations)
      .where(where),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);

  return {
    rows,
    totalCount,
    totalPages,
    page,
    filters: { search, state },
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

export default async function AllocationsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]} />
        <PageHeader title="Vehicle Allocations" description="Manage vehicle assignments to transport requests" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Set DATABASE_URL and run migrations." />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchAllocations>>;
  try {
    result = await fetchAllocations(sp);
  } catch (error) {
    console.error('Allocations query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]} />
        <PageHeader title="Vehicle Allocations" description="Manage vehicle assignments to transport requests" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Allocations" description="The database query failed. Run migrations first." />
      </div>
    );
  }

  const provisionalCount = result.rows.filter((r) => r.state === 'provisional').length;
  const confirmedCount = result.rows.filter((r) => r.state === 'confirmed').length;
  const activeCount = result.rows.filter((r) => r.state === 'provisional' || r.state === 'confirmed').length;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations' }]} />
      <PageHeader title="Vehicle Allocations" description="Manage vehicle assignments to transport requests">
        <Button variant="primary" size="sm" asChild>
          <Link href="/dashboard/allocations/new"><Plus className="h-4 w-4" /> New Allocation</Link>
        </Button>
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{activeCount}</p><p className="text-xs text-ink-500">Active Allocations</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-pending-text">{provisionalCount}</p><p className="text-xs text-ink-500">Provisional</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-info-text">{confirmedCount}</p><p className="text-xs text-ink-500">Confirmed</p></CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input name="search" defaultValue={result.filters.search ?? ''} placeholder="GRN number, make, model, request..." className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">State</label>
              <select name="state" defaultValue={result.filters.state ?? ''} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="">All States</option>
                {Object.entries(ALLOCATION_STATE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit"><Search className="h-4 w-4" /> Filter</Button>
          </form>
        </CardContent>
      </Card>

      {/* Allocation List */}
      {result.rows.length === 0 ? (
        <EmptyState icon={<Truck className="h-8 w-8" />} title="No allocations found" description={result.filters.search ? 'Try adjusting your search criteria.' : 'No vehicle allocations have been made yet.'} />
      ) : (
        <div className="space-y-3">
          {result.rows.map((alloc) => {
            const stateVariant = ALLOCATION_STATE_VARIANTS[alloc.state] ?? 'info';
            const requesterName = alloc.requesterFirstName && alloc.requesterLastName
              ? `${alloc.requesterFirstName} ${alloc.requesterLastName}`
              : null;
            return (
              <Link key={alloc.id} href={`/dashboard/allocations/${alloc.id}`} className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700">
                      <Truck className="h-6 w-6" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-[650] text-ink-950">{alloc.make} {alloc.model}</p>
                        <Badge variant={stateVariant} size="sm">{ALLOCATION_STATE_LABELS[alloc.state] ?? alloc.state}</Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        <span className="tabular-nums">{alloc.licenceNumber}</span>
                        {alloc.requestReference && <span>{alloc.requestReference}</span>}
                        {requesterName && <span>Requester: {requesterName}</span>}
                        <span className="tabular-nums">{formatDate(alloc.startAt)} – {formatDate(alloc.endAt)}</span>
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
          <p className="text-xs text-ink-500">Page {result.page} of {result.totalPages} ({result.totalCount} allocations)</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/allocations', { ...sp, page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" /> Previous</Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/allocations', { ...sp, page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" /></Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
