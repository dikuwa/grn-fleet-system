import { getDb, isDbConnected } from '@/db';
import {
  workflowActions,
  workflowInstances,
  workflowDefinitions,
  workflowSteps,
} from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, desc, and, sql, type SQL, ne } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  Database,
  ClipboardCheck,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { PermissionCode } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { activeApprovalVisibleTo } from '@/lib/approval-queue';
import Link from 'next/link';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap } from '@/lib/statistics';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  overridden: 'Overridden',
};

async function fetchApprovals(
  sp: Record<string, string | undefined>,
  tenantId: string,
  userId: string,
  permissionCodes: readonly PermissionCode[],
) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const status = normalizeOptionalFilter(sp.status);
  const history = sp.view === 'history' || Boolean(status && status !== 'active');

  const baseConditions: SQL[] = [
    eq(transportRequests.tenantId, tenantId),
    history
      ? and(
          ne(workflowInstances.status, 'active'),
          sql`exists (
            select 1 from ${workflowActions}
            where ${workflowActions.instanceId} = ${workflowInstances.id}
              and ${workflowActions.actorUserId} = ${userId}
          )`,
        )!
      : and(
          eq(workflowInstances.status, 'active'),
          activeApprovalVisibleTo(userId, permissionCodes),
        )!,
  ];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (status) {
    conditions.push(eq(workflowInstances.status, status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult, statusCounts] = await Promise.all([
    db
      .select({
        id: workflowInstances.id,
        status: workflowInstances.status,
        currentStepOrder: workflowInstances.currentStepOrder,
        createdAt: workflowInstances.createdAt,
        requestId: workflowInstances.requestId,
        definitionId: workflowInstances.definitionId,
        requestReference: transportRequests.reference,
        requestScope: transportRequests.scope,
        requestStatus: transportRequests.status,
        requestPurpose: transportRequests.purpose,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
        definitionName: workflowDefinitions.name,
      })
      .from(workflowInstances)
      .leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(
        workflowSteps,
        and(
          eq(workflowSteps.definitionId, workflowInstances.definitionId),
          eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
        ),
      )
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(where)
      .orderBy(desc(workflowInstances.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(workflowInstances)
      .leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
      .leftJoin(
        workflowSteps,
        and(
          eq(workflowSteps.definitionId, workflowInstances.definitionId),
          eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
        ),
      )
      .where(where),
    db
      .select({ key: workflowInstances.status, count: sql<number>`count(*)` })
      .from(workflowInstances)
      .leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
      .leftJoin(
        workflowSteps,
        and(
          eq(workflowSteps.definitionId, workflowInstances.definitionId),
          eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
        ),
      )
      .where(baseWhere)
      .groupBy(workflowInstances.status),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const counts = groupedCountMap(statusCounts);

  return {
    rows,
    totalCount,
    totalPages,
    page,
    metrics: {
      total: [...counts.values()].reduce((total, count) => total + count, 0),
      active: counts.get('active') ?? 0,
      completed: counts.get('completed') ?? 0,
    },
    filters: { status, view: history ? 'history' : undefined },
  };
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals' }]} />
        <PageHeader title="Approvals" description="Review and manage workflow approvals" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Authentication Required"
          description="Please sign in to view approvals."
        />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals' }]} />
        <PageHeader title="Approvals" description="Review and manage workflow approvals" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchApprovals>>;
  try {
    const permissionCodes = await getSessionPermissions(session);
    result = await fetchApprovals(sp, session.tenantId, session.user.id, permissionCodes);
  } catch (error) {
    console.error('Approvals query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals' }]} />
        <PageHeader title="Approvals" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Approvals" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals' }]} />
      <PageHeader
        title={result.filters.view === 'history' ? 'Approval History' : 'Assigned Approvals'}
        description={
          result.filters.view === 'history'
            ? 'Decisions you previously completed'
            : 'Requests currently awaiting your decision'
        }
      >
        <Button variant="secondary" size="sm" asChild>
          <Link
            href={
              result.filters.view === 'history'
                ? '/dashboard/approvals'
                : '/dashboard/approvals?view=history'
            }
          >
            {result.filters.view === 'history' ? 'Assigned Approvals' : 'Approval History'}
          </Link>
        </Button>
      </PageHeader>

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-ink-950 text-2xl font-[650] tabular-nums">{result.metrics.total}</p>
            <p className="text-ink-500 text-xs">Total Workflows</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-info-text text-2xl font-[650] tabular-nums">
              {result.metrics.active}
            </p>
            <p className="text-ink-500 text-xs">Active / Awaiting Action</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-status-success-text text-2xl font-[650] tabular-nums">
              {result.metrics.completed}
            </p>
            <p className="text-ink-500 text-xs">Completed</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar
            resetHref="/dashboard/approvals"
            isFiltered={hasActiveFilters(result.filters)}
          >
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
              <StyledSelect
                name="status"
                defaultValue={result.filters.status ?? ''}
                placeholder="All Statuses"
              >
                {Object.entries(WORKFLOW_STATUS_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Approval List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" />}
          title="No approvals found"
          description={
            hasActiveFilters(result.filters)
              ? 'No matching records found. Clear filters to view all records.'
              : 'No workflow instances to review.'
          }
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((wf) => {
            const requesterName =
              wf.requesterFirstName && wf.requesterLastName
                ? `${wf.requesterFirstName} ${wf.requesterLastName}`
                : 'Unknown';
            return (
              <Link
                key={wf.id}
                href={`/dashboard/approvals/${wf.id}`}
                className="border-border bg-surface hover:border-brand-100 block rounded-[10px] border p-4 transition-all hover:shadow-sm"
              >
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <div
                      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${
                        wf.status === 'completed'
                          ? 'bg-status-success-bg text-status-success-text'
                          : wf.status === 'cancelled'
                            ? 'bg-status-cancelled-bg text-status-cancelled-text'
                            : 'bg-status-info-bg text-status-info-text'
                      }`}
                    >
                      {wf.status === 'completed' ? (
                        <CheckCircle2 className="h-6 w-6" />
                      ) : wf.status === 'cancelled' ? (
                        <XCircle className="h-6 w-6" />
                      ) : (
                        <ClipboardCheck className="h-6 w-6" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-ink-950 text-sm font-[650]">
                          {wf.requestReference || 'No Reference'}
                        </p>
                        <StatusBadgeWithIcon status={wf.status} />
                        <Badge
                          variant={wf.requestScope === 'national' ? 'emergency' : 'info'}
                          size="sm"
                        >
                          {wf.requestScope ?? 'regional'}
                        </Badge>
                      </div>
                      <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span>{requesterName}</span>
                        <span>{wf.definitionName || 'Workflow'}</span>
                        <span>Step {wf.currentStepOrder}</span>
                        <span>{formatDate(wf.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <ChevronRight className="text-ink-300 h-4 w-4 shrink-0" />
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
            Page {result.page} of {result.totalPages}
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/approvals', sp, {
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
                  href={buildFilterUrl('/dashboard/approvals', sp, {
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
