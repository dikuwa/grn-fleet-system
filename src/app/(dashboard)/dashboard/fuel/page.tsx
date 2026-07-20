import { getDb, isDbConnected } from '@/db';
import { fuelTransactions } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { eq, desc, and, sql, like, or, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Fuel, Search, ChevronRight, ChevronLeft, Plus } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate, formatCurrency } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

async function fetchFuelEntries(sp: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const search = sp.search?.trim();
  const paymentMethod = sp.payment_method?.trim();
  const anomalyState = sp.anomaly_state?.trim();

  const conditions: SQL[] = [eq(vehicles.tenantId, tenantId)];

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

  const [rows, totalResult] = await Promise.all([
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
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        tripId: fuelTransactions.tripId,
      })
      .from(fuelTransactions)
      .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(where)
      .orderBy(desc(fuelTransactions.transactionAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(fuelTransactions)
      .where(where),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const totalLitres = rows.reduce((sum, r) => sum + Number(r.litres), 0);
  const totalCost = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const flaggedCount = rows.filter((r) => r.anomalyState !== 'none').length;

  return { rows, totalCount, totalPages, page, totalLitres, totalCost, flaggedCount, filters: { search, paymentMethod, anomalyState } };
}

function buildPageUrl(base: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
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

  let result: Awaited<ReturnType<typeof fetchFuelEntries>>;
  try {
    result = await fetchFuelEntries(sp, session.tenantId);
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

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fuel' }]} />
      <PageHeader title="Fuel Records" description="Track fuel transactions and monitor consumption">
        <Button variant="primary" size="sm" asChild>
          <Link href="/dashboard/fuel/new"><Plus className="h-4 w-4" /> New Entry</Link>
        </Button>
      </PageHeader>

      {sp.warning === 'reimbursement_pending' && (
        <div className="flex items-center gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">
          Fuel transaction saved but reimbursement could not be auto-created. Please link your employee account or contact finance to manually process the reimbursement.
        </div>
      )}

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{result.totalCount}</p><p className="text-xs text-ink-500">Transactions</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{result.totalLitres.toFixed(1)} L</p><p className="text-xs text-ink-500">Total Volume</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{formatCurrency(result.totalCost)}</p><p className="text-xs text-ink-500">Total Cost</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className={`text-2xl font-[650] tabular-nums ${result.flaggedCount > 0 ? 'text-status-error-text' : 'text-ink-950'}`}>{result.flaggedCount}</p><p className="text-xs text-ink-500">Flagged</p></CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4 filter-bar-mobile">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input name="search" defaultValue={result.filters.search ?? ''} placeholder="GRN, station, reference..." className="h-10 w-full rounded-[8px] border border-border bg-surface pl-9 pr-3 text-sm text-ink-950 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-brand-200" />
              </div>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Payment Method</label>
              <select name="payment_method" defaultValue={result.filters.paymentMethod ?? ''} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="">All Methods</option>
                <option value="fuel_card">Fuel Card</option>
                <option value="cash">Cash</option>
                <option value="personal_reimbursement">Personal Reimbursement</option>
              </select>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Anomaly</label>
              <select name="anomaly_state" defaultValue={result.filters.anomalyState ?? ''} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="">All States</option>
                <option value="none">Normal</option>
                <option value="flagged">Flagged</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit"><Search className="h-4 w-4" /> Filter</Button>
          </form>
        </CardContent>
      </Card>

      {/* Fuel List */}
      {result.rows.length === 0 ? (
        <EmptyState icon={<Fuel className="h-8 w-8" />} title="No fuel records found" description={result.filters.search ? 'Try adjusting your search.' : 'No fuel transactions recorded yet.'} />
      ) : (
        <div className="space-y-3">
          {result.rows.map((entry) => (
            <Link key={entry.id} href={`/dashboard/fuel/${entry.id}`} className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${entry.anomalyState !== 'none' ? 'bg-status-error-bg text-status-error-text' : 'bg-brand-50 text-brand-700'}`}>
                    <Fuel className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-[650] text-ink-950">{entry.make} {entry.model}</p>
                      <Badge variant={entry.paymentMethod === 'personal_reimbursement' ? 'pending' : entry.paymentMethod === 'fuel_card' ? 'info' : 'default'} size="sm">{entry.paymentMethod.replace(/_/g, ' ')}</Badge>
                      {entry.anomalyState !== 'none' && <Badge variant="error" size="sm">{entry.anomalyState}</Badge>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                      <span className="tabular-nums">{entry.licenceNumber}</span>
                      <span>{entry.stationName || 'Unknown station'}</span>
                      <span>{formatDate(entry.transactionAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-[650] tabular-nums text-ink-950">{Number(entry.litres).toFixed(1)} L</p>
                  <p className="text-xs tabular-nums text-ink-500">{formatCurrency(Number(entry.amount))}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-ink-500">Page {result.page} of {result.totalPages} ({result.totalCount} entries)</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/fuel', { ...sp, page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" /> Previous</Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildPageUrl('/dashboard/fuel', { ...sp, page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" /></Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
