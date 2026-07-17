import { getDb, isDbConnected } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { eq, desc, and, sql, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, CreditCard, Search, ChevronRight, ChevronLeft } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate, formatCurrency } from '@/lib/utils';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const REIMBURSEMENT_STATE_LABELS: Record<string, string> = {
  pending: 'Pending', approved: 'Approved', paid: 'Paid', rejected: 'Rejected',
};

const REIMBURSEMENT_STATE_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  pending: 'pending', approved: 'info', paid: 'success', rejected: 'error',
};

async function fetchReimbursements(sp: Record<string, string | undefined>) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const state = sp.state?.trim();

  const conditions: SQL[] = [];

  if (state) {
    conditions.push(eq(reimbursements.state, state));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
    db
      .select({
        id: reimbursements.id,
        amount: reimbursements.amount,
        state: reimbursements.state,
        paidAt: reimbursements.paidAt,
        createdAt: reimbursements.createdAt,
        claimantFirstName: employees.firstName,
        claimantLastName: employees.lastName,
        licenceNumber: vehicles.licenceNumber,
      })
      .from(reimbursements)
      .leftJoin(employees, eq(reimbursements.claimantEmployeeId, employees.id))
      .leftJoin(fuelTransactions, eq(reimbursements.transactionId, fuelTransactions.id))
      .leftJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(where)
      .orderBy(desc(reimbursements.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(reimbursements)
      .where(where),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const totalAmount = rows.reduce((sum, r) => sum + Number(r.amount), 0);
  const pendingCount = rows.filter((r) => r.state === 'pending').length;

  return { rows, totalCount, totalPages, page, totalAmount, pendingCount, filters: { state } };
}

function buildPageUrl(base: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  return sp.toString() ? `${base}?${sp.toString()}` : base;
}

export default async function ReimbursementsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reimbursements' }]} />
        <PageHeader title="Reimbursements" description="Manage personal fuel expense claims" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchReimbursements>>;
  try {
    result = await fetchReimbursements(sp);
  } catch (error) {
    console.error('Reimbursements query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reimbursements' }]} />
        <PageHeader title="Reimbursements" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Reimbursements" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reimbursements' }]} />
      <PageHeader title="Reimbursements" description="Manage personal fuel expense claims" />

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{result.totalCount}</p><p className="text-xs text-ink-500">Total Claims</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-pending-text">{result.pendingCount}</p><p className="text-xs text-ink-500">Pending</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{formatCurrency(result.totalAmount)}</p><p className="text-xs text-ink-500">Total Amount</p></CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4">
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Status</label>
              <select name="state" defaultValue={result.filters.state ?? ''} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="">All Statuses</option>
                {Object.entries(REIMBURSEMENT_STATE_LABELS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit"><Search className="h-4 w-4" /> Filter</Button>
          </form>
        </CardContent>
      </Card>

      {/* Reimbursement List */}
      {result.rows.length === 0 ? (
        <EmptyState icon={<CreditCard className="h-8 w-8" />} title="No reimbursements found" description="No personal fuel expense claims have been submitted." />
      ) : (
        <div className="space-y-3">
          {result.rows.map((r) => (
            <Link key={r.id} href={`/dashboard/fuel/${r.id}`} className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] bg-status-pending-bg text-status-pending-text">
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-[650] text-ink-950">{r.claimantFirstName} {r.claimantLastName}</p>
                      <Badge variant={REIMBURSEMENT_STATE_VARIANTS[r.state] ?? 'pending'} size="sm">{REIMBURSEMENT_STATE_LABELS[r.state] ?? r.state}</Badge>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                      {r.licenceNumber && <span className="tabular-nums">{r.licenceNumber}</span>}
                      <span>{formatDate(r.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-[650] tabular-nums text-ink-950">{formatCurrency(Number(r.amount))}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-ink-500">Page {result.page} of {result.totalPages} ({result.totalCount} claims)</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && <Button variant="secondary" size="sm" asChild><Link href={buildPageUrl('/dashboard/reimbursements', { ...sp, page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" /> Previous</Link></Button>}
            {result.page < result.totalPages && <Button variant="secondary" size="sm" asChild><Link href={buildPageUrl('/dashboard/reimbursements', { ...sp, page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" /></Link></Button>}
          </div>
        </div>
      )}
    </div>
  );
}
