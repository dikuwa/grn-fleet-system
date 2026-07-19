import { getDb, isDbConnected } from '@/db';
import { vehicleInspections } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';

import { eq, desc, asc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Search, ChevronRight, ChevronLeft, ClipboardCheck, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const INSPECTION_TYPE_LABELS: Record<string, string> = {
  departure: 'Departure',
  return: 'Return',
};

async function fetchInspections(sp: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const type = sp.type?.trim();
  const status = sp.status?.trim();
  const search = sp.search?.trim();

  const conditions: SQL[] = [eq(vehicleInspections.tenantId, tenantId)];

  if (type) {
    conditions.push(eq(vehicleInspections.type, type));
  }
  if (status) {
    conditions.push(eq(vehicleInspections.status, status));
  }
  if (search) {
    conditions.push(
      or(
        like(vehicles.licenceNumber, `%${search}%`),
        like(vehicles.make, `%${search}%`),
        like(vehicles.model, `%${search}%`),
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
    db
      .select({ count: sql<number>`count(*)` })
      .from(vehicleInspections)
      .where(where),
    // Summary stats for all inspections in this tenant (unfiltered)
    db
      .select({
        type: vehicleInspections.type,
        status: vehicleInspections.status,
        pass: vehicleInspections.overallPass,
        count: sql<number>`count(*)`,
      })
      .from(vehicleInspections)
      .where(eq(vehicleInspections.tenantId, tenantId))
      .groupBy(vehicleInspections.type, vehicleInspections.status, vehicleInspections.overallPass),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);

  // Compute summary stats
  const totalInspections = summary.reduce((sum, r) => sum + r.count, 0);
  const departureCount = summary.filter((r) => r.type === 'departure').reduce((sum, r) => sum + r.count, 0);
  const returnCount = summary.filter((r) => r.type === 'return').reduce((sum, r) => sum + r.count, 0);
  const passCount = summary.filter((r) => r.pass === true).reduce((sum, r) => sum + r.count, 0);
  const failCount = summary.filter((r) => r.pass === false).reduce((sum, r) => sum + r.count, 0);
  const passRate = totalInspections > 0 ? Math.round((passCount / totalInspections) * 100) : 0;

  return {
    rows, totalCount, totalPages, page,
    filters: { type, status, search },
    summary: { totalInspections, departureCount, returnCount, passCount, failCount, passRate },
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

  let result: Awaited<ReturnType<typeof fetchInspections>>;
  try {
    result = await fetchInspections(sp, session.tenantId);
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

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections' }]} />
      <PageHeader title="Vehicle Inspections" description="Pre-trip departure and post-trip return inspections">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections/departure"><ClipboardCheck className="h-4 w-4" /> New Departure Inspection</Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections/return"><ClipboardCheck className="h-4 w-4" /> New Return Inspection</Link>
        </Button>
      </PageHeader>

      {/* Type Tabs */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-2 border-b border-border pb-3">
            <Link
              href="/dashboard/inspections"
              className={`px-4 py-1.5 text-sm rounded-full transition-colors ${!activeTab ? 'bg-brand-800 text-white' : 'text-ink-500 hover:text-ink-700 hover:bg-muted'}`}
            >
              All
            </Link>
            {Object.entries(INSPECTION_TYPE_LABELS).map(([value, label]) => (
              <Link
                key={value}
                href={`/dashboard/inspections?type=${value}`}
                className={`px-4 py-1.5 text-sm rounded-full transition-colors ${activeTab === value ? 'bg-brand-800 text-white' : 'text-ink-500 hover:text-ink-700 hover:bg-muted'}`}
              >
                {label}
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{result.summary.totalInspections}</p><p className="text-xs text-ink-500">Total</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-brand-700">{result.summary.departureCount}</p><p className="text-xs text-ink-500">Departures</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-brand-700">{result.summary.returnCount}</p><p className="text-xs text-ink-500">Returns</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-success-text">{result.summary.passCount}</p><p className="text-xs text-ink-500">Passed</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-error-text">{result.summary.failCount}</p><p className="text-xs text-ink-500">Failed</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{result.summary.passRate}%</p><p className="text-xs text-ink-500">Pass Rate</p></CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Search Vehicle</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input name="search" defaultValue={result.filters.search ?? ''} placeholder="Licence, make, model..." className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Status</label>
              <select name="status" defaultValue={result.filters.status ?? ''} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="">All Statuses</option>
                <option value="in_progress">In Progress</option>
                <option value="completed">Completed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
            <input type="hidden" name="type" value={activeTab} />
            <Button variant="primary" size="sm" type="submit"><Search className="h-4 w-4" /> Filter</Button>
          </form>
        </CardContent>
      </Card>

      {/* Inspection List */}
      {result.rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-8 w-8" />} title="No inspections found" description={activeTab ? `No ${activeTab} inspections recorded yet.` : 'No vehicle inspections recorded yet.'} />
      ) : (
        <div className="space-y-3">
          {result.rows.map((insp) => (
            <Link key={insp.id} href={`/dashboard/inspections/${insp.id}`} className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${insp.overallPass === true ? 'bg-status-success-bg text-status-success-text' : insp.overallPass === false ? 'bg-status-error-bg text-status-error-text' : 'bg-muted text-ink-500'}`}>
                    <ClipboardCheck className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-[650] text-ink-950 capitalize">{insp.type} Inspection</p>
                      <Badge variant={insp.status === 'completed' ? 'success' : insp.status === 'failed' ? 'error' : 'pending'} size="sm">{insp.status?.replace(/_/g, ' ')}</Badge>
                      {insp.overallPass != null && (
                        <Badge variant={insp.overallPass ? 'success' : 'error'} size="sm">{insp.overallPass ? 'Pass' : 'Fail'}</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                      <span>{insp.make} {insp.model}</span>
                      <span className="tabular-nums">{insp.licenceNumber}</span>
                      {insp.odometerReading && <span>{insp.odometerReading.toLocaleString()} km</span>}
                      <span className="tabular-nums">{formatDate(insp.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-300 shrink-0" />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-ink-500">Page {result.page} of {result.totalPages} ({result.totalCount} inspections)</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/inspections', { ...sp, page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" /> Previous</Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/inspections', { ...sp, page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" /></Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
