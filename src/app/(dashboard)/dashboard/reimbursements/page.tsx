import { getDb, isDbConnected } from '@/db';
import { reimbursements, fuelTransactions } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { eq, desc, and, sql, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import { Database, CreditCard, ChevronRight, ChevronLeft } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate, formatCurrency } from '@/lib/utils';
import Link from 'next/link';
import { getServerSession } from '@/lib/session';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { numericCount } from '@/lib/statistics';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const REIMBURSEMENT_STATE_LABELS: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
};

async function fetchReimbursements(sp: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const state = normalizeOptionalFilter(sp.state);

  const baseConditions: SQL[] = [eq(employees.tenantId, tenantId)];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (state) {
    conditions.push(eq(reimbursements.state, state));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult, metricResult] = await Promise.all([
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
      .innerJoin(employees, eq(reimbursements.claimantEmployeeId, employees.id))
      .where(where),
    db
      .select({
        total: sql<number>`count(*)`,
        amount: sql<string>`coalesce(sum(${reimbursements.amount}), 0)`,
        pending: sql<number>`count(*) filter (where ${reimbursements.state} = 'pending')`,
      })
      .from(reimbursements)
      .innerJoin(employees, eq(reimbursements.claimantEmployeeId, employees.id))
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
      amount: numericCount(metrics?.amount),
      pending: numericCount(metrics?.pending),
    },
    filters: { state },
  };
}

export default async function ReimbursementsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const session = await getServerSession();
  if (!session) return null;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reimbursements' }]}
        />
        <PageHeader title="Reimbursements" description="Manage personal fuel expense claims" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchReimbursements>>;
  try {
    result = await fetchReimbursements(sp, session.tenantId);
  } catch (error) {
    console.error('Reimbursements query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reimbursements' }]}
        />
        <PageHeader title="Reimbursements" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Reimbursements" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Reimbursements' }]}
      />
      <PageHeader title="Reimbursements" description="Manage personal fuel expense claims" />

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">{result.metrics.total}</p>
            <p className="text-ink-500 text-xs">Total Claims</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-pending-text text-2xl font-[650] tabular-nums">
              {result.metrics.pending}
            </p>
            <p className="text-ink-500 text-xs">Pending</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">
              {formatCurrency(result.metrics.amount)}
            </p>
            <p className="text-ink-500 text-xs">Total Amount</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar
            resetHref="/dashboard/reimbursements"
            isFiltered={hasActiveFilters(result.filters)}
          >
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
              <StyledSelect
                name="state"
                defaultValue={result.filters.state ?? ''}
                placeholder="All Statuses"
              >
                {Object.entries(REIMBURSEMENT_STATE_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Reimbursement List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-8 w-8" />}
          title="No reimbursements found"
          description={
            hasActiveFilters(result.filters)
              ? 'No matching records found. Clear filters to view all records.'
              : 'No personal fuel expense claims have been submitted.'
          }
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((r) => (
            <Link
              key={r.id}
              href={`/dashboard/fuel/${r.id}`}
              className="border-border bg-surface hover:border-brand-100 block rounded-[10px] border p-4 transition-all hover:shadow-sm"
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="bg-status-pending-bg text-status-pending-text flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px]">
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-ink-950 text-sm font-[650]">
                        {r.claimantFirstName} {r.claimantLastName}
                      </p>{' '}
                      <StatusBadgeWithIcon status={r.state} />
                    </div>
                    <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {r.licenceNumber && <span className="tabular-nums">{r.licenceNumber}</span>}
                      <span>{formatDate(r.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-ink-950 text-sm font-[650] tabular-nums">
                    {formatCurrency(Number(r.amount))}
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
            Page {result.page} of {result.totalPages} ({result.totalCount} claims)
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/reimbursements', sp, {
                    page: String(result.page - 1),
                  })}
                >
                  <ChevronLeft className="h-3 w-3" /> Previous
                </Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/reimbursements', sp, {
                    page: String(result.page + 1),
                  })}
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
