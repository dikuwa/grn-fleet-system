import Link from 'next/link';
import { and, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { getDb, isDbConnected } from '@/db';
import {
  workflowActions,
  workflowDefinitions,
  workflowInstances,
  workflowSteps,
} from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Database,
  XCircle,
} from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { PermissionCode } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { activeApprovalVisibleTo } from '@/lib/approval-queue';
import { WorkflowEngine } from '@/lib/workflow-engine';
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

async function resolveVisibleActiveInstanceIds(
  tenantId: string,
  userId: string,
  permissionCodes: readonly PermissionCode[],
) {
  const db = getDb();

  // First use the indexed/static workflow fields as a cheap candidate filter.
  // Permission-routed steps are frequently unassigned in the definition because
  // the workflow engine resolves the responsible employee/acting delegate at
  // runtime. Candidate selection therefore must remain broader than the final
  // visibility decision.
  const candidates = await db
    .select({ id: workflowInstances.id })
    .from(workflowInstances)
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .leftJoin(
      workflowSteps,
      and(
        eq(workflowSteps.definitionId, workflowInstances.definitionId),
        eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
      ),
    )
    .where(
      and(
        eq(transportRequests.tenantId, tenantId),
        eq(workflowInstances.status, 'active'),
        activeApprovalVisibleTo(userId, permissionCodes),
      ),
    );

  if (candidates.length === 0) return [] as string[];

  const engine = new WorkflowEngine({ db });
  const permissionSet = new Set<PermissionCode>(permissionCodes);
  const statuses = await Promise.all(
    candidates.map(async ({ id }) => ({ id, status: await engine.getWorkflowStatus(id) })),
  );

  return statuses
    .filter(({ status }) => {
      const step = status?.currentStep;
      if (!status || status.instance.status !== 'active' || !step) return false;

      // Driver acknowledgement belongs in Driver Trips/Driver Console. It is
      // deliberately not an approval-workspace item and must never be exposed
      // to every driver merely because they share DRIVER_LOG_CREATE.
      if (step.actionType === 'acknowledge') return false;

      if (step.assignedUserId) return step.assignedUserId === userId;
      if (!step.requiredPermission) return false;
      return permissionSet.has(step.requiredPermission as PermissionCode);
    })
    .map(({ id }) => id);
}

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

  const visibleActiveIds = history
    ? []
    : await resolveVisibleActiveInstanceIds(tenantId, userId, permissionCodes);

  const activeVisibility: SQL = visibleActiveIds.length > 0
    ? inArray(workflowInstances.id, visibleActiveIds)
    : sql`false`;

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
      : and(eq(workflowInstances.status, 'active'), activeVisibility)!,
  ];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (status) conditions.push(eq(workflowInstances.status, status));
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
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(where)
      .orderBy(desc(workflowInstances.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(workflowInstances)
      .leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
      .where(where),
    db
      .select({ key: workflowInstances.status, count: sql<number>`count(*)` })
      .from(workflowInstances)
      .leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
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
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view approvals." />
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
        description={result.filters.view === 'history' ? 'Decisions you previously completed' : 'Requests currently awaiting your decision'}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href={result.filters.view === 'history' ? '/dashboard/approvals' : '/dashboard/approvals?view=history'}>
            {result.filters.view === 'history' ? 'Assigned Approvals' : 'Approval History'}
          </Link>
        </Button>
      </PageHeader>

      <div className="border-border grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border bg-border">
        {[
          ['Total', result.metrics.total, 'text-ink-950'],
          ['Awaiting Action', result.metrics.active, 'text-status-info-text'],
          ['Completed', result.metrics.completed, 'text-status-success-text'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="bg-surface px-3 py-3 text-left sm:px-5 sm:py-4">
            <p className={`text-xl font-semibold tabular-nums sm:text-2xl ${tone}`}>{value}</p>
            <p className="text-ink-500 mt-1 text-[11px] sm:text-xs">{label}</p>
          </div>
        ))}
      </div>

      <div className="border-border border-y py-4">
        <FilterToolbar resetHref="/dashboard/approvals" isFiltered={hasActiveFilters(result.filters)}>
          <div className="w-full sm:w-[220px]">
            <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
            <StyledSelect name="status" defaultValue={result.filters.status ?? ''} placeholder="All Statuses">
              {Object.entries(WORKFLOW_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </StyledSelect>
          </div>
        </FilterToolbar>
      </div>

      {result.rows.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-8 w-8" />}
          title="No approvals found"
          description={hasActiveFilters(result.filters) ? 'No matching records found. Clear filters to view all records.' : result.filters.view === 'history' ? 'You have no completed approval decisions yet.' : 'Nothing is currently assigned to you.'}
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {result.rows.map((workflow) => {
            const requesterName = workflow.requesterFirstName && workflow.requesterLastName
              ? `${workflow.requesterFirstName} ${workflow.requesterLastName}`
              : 'Unknown requester';
            return (
              <Link
                key={workflow.id}
                href={`/dashboard/approvals/${workflow.id}`}
                className="focus-ring group border-border hover:bg-muted/40 block border-b px-4 py-4 transition-colors motion-reduce:transition-none last:border-b-0 sm:px-5"
              >
                <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] sm:mt-0 ${workflow.status === 'completed' ? 'bg-status-success-bg text-status-success-text' : workflow.status === 'cancelled' ? 'bg-status-cancelled-bg text-status-cancelled-text' : 'bg-status-info-bg text-status-info-text'}`}>
                    {workflow.status === 'completed' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : workflow.status === 'cancelled' ? <XCircle className="h-4 w-4" aria-hidden="true" /> : <ClipboardCheck className="h-4 w-4" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-ink-950 text-sm font-semibold">{workflow.requestReference || 'No Reference'}</p>
                      <StatusBadgeWithIcon status={workflow.status} />
                      <Badge variant={workflow.requestScope === 'national' ? 'emergency' : 'info'} size="sm">{workflow.requestScope ?? 'regional'}</Badge>
                    </div>
                    {workflow.requestPurpose && <p className="text-ink-700 mt-1 line-clamp-2 text-sm">{workflow.requestPurpose}</p>}
                    <div className="text-ink-500 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                      <span>{requesterName}</span>
                      <span>{workflow.definitionName || 'Workflow'}</span>
                      <span>Step {workflow.currentStepOrder}</span>
                      <span>{formatDate(workflow.createdAt)}</span>
                    </div>
                  </div>
                  <ChevronRight className="text-ink-300 group-hover:text-brand-700 mt-1 h-4 w-4 shrink-0 sm:mt-0" aria-hidden="true" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <p className="text-ink-500 text-xs">Page {result.page} of {result.totalPages}</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildFilterUrl('/dashboard/approvals', sp, { page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" aria-hidden="true" />Previous</Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link href={buildFilterUrl('/dashboard/approvals', sp, { page: String(result.page + 1) })}>Next<ChevronRight className="h-3 w-3" aria-hidden="true" /></Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
