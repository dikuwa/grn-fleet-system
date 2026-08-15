import Link from 'next/link';
import { and, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { getDb, isDbConnected } from '@/db';
import { workflowActions, workflowDefinitions, workflowInstances } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { StatusBadgeWithIcon } from '@/components/ui/status-badge-icon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import { CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Database, XCircle } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import type { PermissionCode } from '@/lib/permissions';
import { formatDate } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionPermissions } from '@/lib/auth-helpers';
import { resolveActionableApprovalInstanceIds } from '@/lib/approval-queue';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { groupedCountMap } from '@/lib/statistics';

interface PageProps { searchParams: Promise<Record<string, string | undefined>>; }

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  active: 'Active', completed: 'Completed', cancelled: 'Cancelled', overridden: 'Overridden',
};

function attentionLabel(updatedAt: Date, active: boolean) {
  if (!active) return null;
  const ageHours = Math.max(0, (Date.now() - updatedAt.getTime()) / 3_600_000);
  if (ageHours < 2) return { label: 'New', variant: 'info' as const };
  if (ageHours >= 24) return { label: 'Priority', variant: 'warning' as const };
  return { label: 'Awaiting action', variant: 'pending' as const };
}

async function resolveVisibleActiveInstanceIds(tenantId: string, userId: string, permissionCodes: readonly PermissionCode[]) {
  return resolveActionableApprovalInstanceIds({ db: getDb(), tenantId, userId, permissionCodes });
}

async function fetchApprovals(sp: Record<string, string | undefined>, tenantId: string, userId: string, permissionCodes: readonly PermissionCode[]) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const status = normalizeOptionalFilter(sp.status);
  const history = sp.view === 'history' || Boolean(status && status !== 'active');
  const visibleActiveIds = history ? [] : await resolveVisibleActiveInstanceIds(tenantId, userId, permissionCodes);
  const activeVisibility: SQL = visibleActiveIds.length > 0 ? inArray(workflowInstances.id, visibleActiveIds) : sql`false`;
  const baseConditions: SQL[] = [
    eq(transportRequests.tenantId, tenantId),
    history
      ? and(ne(workflowInstances.status, 'active'), sql`exists (select 1 from ${workflowActions} where ${workflowActions.instanceId} = ${workflowInstances.id} and ${workflowActions.actorUserId} = ${userId})`)!
      : and(eq(workflowInstances.status, 'active'), activeVisibility)!,
  ];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];
  if (status) conditions.push(eq(workflowInstances.status, status));
  const where = and(...conditions);

  const [rows, totalResult, statusCounts] = await Promise.all([
    db.select({
      id: workflowInstances.id,
      status: workflowInstances.status,
      currentStepOrder: workflowInstances.currentStepOrder,
      createdAt: workflowInstances.createdAt,
      updatedAt: workflowInstances.updatedAt,
      requestId: workflowInstances.requestId,
      definitionId: workflowInstances.definitionId,
      requestReference: transportRequests.reference,
      requestScope: transportRequests.scope,
      requestStatus: transportRequests.status,
      requestPurpose: transportRequests.purpose,
      requesterFirstName: employees.firstName,
      requesterLastName: employees.lastName,
      definitionName: workflowDefinitions.name,
    }).from(workflowInstances)
      .leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
      .leftJoin(workflowDefinitions, eq(workflowInstances.definitionId, workflowDefinitions.id))
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(where).orderBy(desc(workflowInstances.updatedAt), desc(workflowInstances.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(workflowInstances).leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id)).where(where),
    db.select({ key: workflowInstances.status, count: sql<number>`count(*)` }).from(workflowInstances).leftJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id)).where(baseWhere).groupBy(workflowInstances.status),
  ]);
  const totalCount = Number(totalResult[0]?.count ?? 0);
  const counts = groupedCountMap(statusCounts);
  return {
    rows, totalCount, totalPages: Math.ceil(totalCount / limit), page,
    metrics: { total: [...counts.values()].reduce((total, count) => total + count, 0), active: counts.get('active') ?? 0, completed: counts.get('completed') ?? 0 },
    filters: { status, view: history ? 'history' : undefined },
  };
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const session = await getServerSession();
  if (!session) return <div className="space-y-6"><Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals' }]} /><PageHeader title="Approvals" description="Review and manage workflow approvals" /><EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view approvals." /></div>;
  if (!isDbConnected()) return <div className="space-y-6"><Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals' }]} /><PageHeader title="Approvals" description="Review and manage workflow approvals" /><EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" /></div>;

  let result: Awaited<ReturnType<typeof fetchApprovals>>;
  try {
    const permissionCodes = await getSessionPermissions(session);
    result = await fetchApprovals(sp, session.tenantId, session.user.id, permissionCodes);
  } catch (error) {
    console.error('Approvals query failed:', error);
    return <div className="space-y-6"><Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals' }]} /><PageHeader title="Approvals" /><EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Approvals" /></div>;
  }

  const historyView = result.filters.view === 'history';
  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Approvals' }]} />
      <PageHeader title={historyView ? 'Approval History' : 'Assigned Approvals'} description={historyView ? 'Decisions you previously attended to' : 'Only requests that still require your action are counted here'}>
        <Button variant="secondary" size="sm" asChild><Link href={historyView ? '/dashboard/approvals' : '/dashboard/approvals?view=history'}>{historyView ? 'Assigned Approvals' : 'Attended / History'}</Link></Button>
      </PageHeader>

      <div className="border-border grid grid-cols-3 gap-px overflow-hidden rounded-[10px] border bg-border">
        {[
          [historyView ? 'Attended' : 'Assigned now', result.metrics.total, 'text-ink-950'],
          ['Needs action', result.metrics.active, 'text-status-info-text'],
          ['Completed', result.metrics.completed, 'text-status-success-text'],
        ].map(([label, value, tone]) => <div key={String(label)} className="bg-surface px-3 py-3 sm:px-5 sm:py-4"><p className={`text-xl font-semibold tabular-nums sm:text-2xl ${tone}`}>{value}</p><p className="text-ink-500 mt-1 text-[11px] sm:text-xs">{label}</p></div>)}
      </div>

      <div className="border-border border-y py-4">
        <FilterToolbar resetHref="/dashboard/approvals" isFiltered={hasActiveFilters(result.filters)}>
          <div className="w-full sm:w-[220px]"><label className="text-ink-500 mb-1 block text-xs font-medium">Status</label><StyledSelect name="status" defaultValue={result.filters.status ?? ''} placeholder="All Statuses">{Object.entries(WORKFLOW_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</StyledSelect></div>
        </FilterToolbar>
      </div>

      {result.rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-8 w-8" />} title={historyView ? 'No attended approvals' : 'You are up to date'} description={hasActiveFilters(result.filters) ? 'No matching records found. Clear filters to view all records.' : historyView ? 'Your completed decisions will remain available here for reference.' : 'There are no current workflow decisions assigned to you.'} />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {result.rows.map((workflow) => {
            const requesterName = workflow.requesterFirstName && workflow.requesterLastName ? `${workflow.requesterFirstName} ${workflow.requesterLastName}` : 'Unknown requester';
            const attention = attentionLabel(new Date(workflow.updatedAt), workflow.status === 'active');
            return (
              <Link key={workflow.id} href={`/dashboard/approvals/${workflow.id}`} className="focus-ring group border-border hover:bg-muted/40 block cursor-pointer border-b px-4 py-4 transition-colors motion-reduce:transition-none last:border-b-0 sm:px-5">
                <div className="flex items-start gap-3 sm:items-center sm:gap-4">
                  <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] sm:mt-0 ${workflow.status === 'completed' ? 'bg-status-success-bg text-status-success-text' : workflow.status === 'cancelled' ? 'bg-status-cancelled-bg text-status-cancelled-text' : 'bg-status-info-bg text-status-info-text'}`}>
                    {workflow.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> : workflow.status === 'cancelled' ? <XCircle className="h-4 w-4" /> : <ClipboardCheck className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-ink-950 text-sm font-semibold">{workflow.requestReference || 'No Reference'}</p>
                      <StatusBadgeWithIcon status={workflow.status} />
                      {attention && <Badge variant={attention.variant} size="sm">{attention.label}</Badge>}
                      {!attention && historyView && <Badge variant="success" size="sm">Attended</Badge>}
                      <Badge variant={workflow.requestScope === 'national' ? 'emergency' : 'info'} size="sm">{workflow.requestScope ?? 'regional'}</Badge>
                    </div>
                    {workflow.requestPurpose && <p className="text-ink-700 mt-1 line-clamp-2 text-sm">{workflow.requestPurpose}</p>}
                    <div className="text-ink-500 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs"><span>{requesterName}</span><span>{workflow.definitionName || 'Workflow'}</span><span>Current step {workflow.currentStepOrder}</span><span>Updated {formatDate(workflow.updatedAt)}</span></div>
                  </div>
                  <ChevronRight className="text-ink-300 group-hover:text-brand-700 mt-1 h-4 w-4 shrink-0 sm:mt-0" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      {result.totalPages > 1 && <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-ink-500 text-xs">Page {result.page} of {result.totalPages}</p><div className="flex items-center gap-2">{result.page > 1 && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/approvals', sp, { page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" />Previous</Link></Button>}{result.page < result.totalPages && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/approvals', sp, { page: String(result.page + 1) })}>Next<ChevronRight className="h-3 w-3" /></Link></Button>}</div></div>}
    </div>
  );
}
