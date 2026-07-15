import { getDb, isDbConnected } from '@/db';
import { workflowInstances, workflowDefinitions } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, desc, and, sql, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, ClipboardCheck, Search, ChevronRight, ChevronLeft, CheckCircle2, XCircle } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import Link from 'next/link';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  active: 'Active', completed: 'Completed', cancelled: 'Cancelled', overridden: 'Overridden',
};

async function fetchApprovals(sp: Record<string, string | undefined>) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const status = sp.status?.trim();

  const conditions: SQL[] = [];

  if (status) {
    conditions.push(eq(workflowInstances.status, status));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
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
      .where(where),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);
  const activeCount = rows.filter((r) => r.status === 'active').length;
  const completedCount = rows.filter((r) => r.status === 'completed').length;

  return { rows, totalCount, totalPages, page, activeCount, completedCount, filters: { status } };
}

function buildPageUrl(base: string, params: Record<string, string | undefined>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) sp.set(key, value);
  }
  return sp.toString() ? `${base}?${sp.toString()}` : base;
}

export default async function ApprovalsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

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
    result = await fetchApprovals(sp);
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
      <PageHeader title="Approvals" description="Review and manage workflow approvals" />

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-ink-950">{result.totalCount}</p><p className="text-xs text-ink-500">Total Workflows</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-info-text">{result.activeCount}</p><p className="text-xs text-ink-500">Active / Awaiting Action</p></CardContent></Card>
        <Card><CardContent className="pt-4 text-center"><p className="text-2xl font-[650] tabular-nums text-status-success-text">{result.completedCount}</p><p className="text-xs text-ink-500">Completed</p></CardContent></Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4">
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">Status</label>
              <select name="status" defaultValue={result.filters.status ?? ''} className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200">
                <option value="">All Statuses</option>
                {Object.entries(WORKFLOW_STATUS_LABELS).map(([v, l]) => (<option key={v} value={v}>{l}</option>))}
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit"><Search className="h-4 w-4" /> Filter</Button>
          </form>
        </CardContent>
      </Card>

      {/* Approval List */}
      {result.rows.length === 0 ? (
        <EmptyState icon={<ClipboardCheck className="h-8 w-8" />} title="No approvals found" description="No workflow instances to review." />
      ) : (
        <div className="space-y-3">
          {result.rows.map((wf) => {
            const requesterName = wf.requesterFirstName && wf.requesterLastName ? `${wf.requesterFirstName} ${wf.requesterLastName}` : 'Unknown';
            return (
              <Link key={wf.id} href={`/dashboard/approvals/${wf.id}`} className="block rounded-[10px] border border-border bg-surface p-4 transition-all hover:border-brand-100 hover:shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-[8px] ${
                      wf.status === 'completed' ? 'bg-status-success-bg text-status-success-text' :
                      wf.status === 'cancelled' ? 'bg-status-cancelled-bg text-status-cancelled-text' :
                      'bg-status-info-bg text-status-info-text'
                    }`}>
                      {wf.status === 'completed' ? <CheckCircle2 className="h-6 w-6" /> :
                       wf.status === 'cancelled' ? <XCircle className="h-6 w-6" /> :
                       <ClipboardCheck className="h-6 w-6" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-[650] text-ink-950">{wf.requestReference || 'No Reference'}</p>
                        <Badge variant={wf.status === 'active' ? 'info' : wf.status === 'completed' ? 'success' : wf.status === 'overridden' ? 'emergency' : 'cancelled'} size="sm">
                          {WORKFLOW_STATUS_LABELS[wf.status] ?? wf.status}
                        </Badge>
                        <Badge variant={wf.requestScope === 'national' ? 'emergency' : 'info'} size="sm">{wf.requestScope ?? 'regional'}</Badge>
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                        <span>{requesterName}</span>
                        <span>{wf.definitionName || 'Workflow'}</span>
                        <span>Step {wf.currentStepOrder}</span>
                        <span>{formatDate(wf.createdAt)}</span>
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
          <p className="text-xs text-ink-500">Page {result.page} of {result.totalPages}</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && <Button variant="secondary" size="sm" asChild><Link href={buildPageUrl('/dashboard/approvals', { ...sp, page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" /> Previous</Link></Button>}
            {result.page < result.totalPages && <Button variant="secondary" size="sm" asChild><Link href={buildPageUrl('/dashboard/approvals', { ...sp, page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" /></Link></Button>}
          </div>
        </div>
      )}
    </div>
  );
}
