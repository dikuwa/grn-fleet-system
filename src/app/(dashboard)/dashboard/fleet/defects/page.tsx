import Link from 'next/link';
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { getDb, isDbConnected } from '@/db';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Database,
  Eye,
} from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { DefectResolveButton } from './DefectResolveButton';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import {
  canPerformDashboardAction,
  resolveDashboardAccess,
  type DashboardRecordScope,
} from '@/lib/dashboard-access';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { numericCount } from '@/lib/statistics';
import { defectScopeCondition } from '@/lib/record-scope';

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  major: 1,
  minor: 2,
  informational: 3,
};

const SEVERITY_LABELS: Record<string, string> = {
  informational: 'Informational',
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
};

async function fetchDefects(
  sp: Record<string, string | undefined>,
  tenantId: string,
  userId: string,
  recordScope: DashboardRecordScope,
) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const severity = normalizeOptionalFilter(sp.severity);
  const status = normalizeOptionalFilter(sp.status);

  const baseConditions: SQL[] = [
    defectScopeCondition({ tenantId, userId, recordScope }),
  ];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];
  if (status === 'open') conditions.push(isNull(vehicleDefects.resolvedAt));
  else if (status === 'resolved') conditions.push(isNotNull(vehicleDefects.resolvedAt));
  if (severity) conditions.push(eq(vehicleDefects.severity, severity));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult, metricResult] = await Promise.all([
    db
      .select({
        id: vehicleDefects.id,
        severity: vehicleDefects.severity,
        description: vehicleDefects.description,
        isBlocking: vehicleDefects.isBlocking,
        createdAt: vehicleDefects.createdAt,
        resolvedAt: vehicleDefects.resolvedAt,
        resolutionNotes: vehicleDefects.resolutionNotes,
        vehicleId: vehicleDefects.vehicleId,
        vehicleGrn: vehicles.licenceNumber,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        tripId: vehicleDefects.tripId,
        inspectionId: vehicleDefects.inspectionId,
      })
      .from(vehicleDefects)
      .leftJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(where)
      .orderBy(desc(vehicleDefects.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(where),
    db
      .select({
        total: sql<number>`count(*)`,
        open: sql<number>`count(*) filter (where ${vehicleDefects.resolvedAt} is null)`,
        resolved: sql<number>`count(*) filter (where ${vehicleDefects.resolvedAt} is not null)`,
      })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(baseWhere),
  ]);

  rows.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));
  const totalCount = Number(totalResult[0]?.count ?? 0);
  const metrics = metricResult[0];
  return {
    rows,
    totalCount,
    totalPages: Math.ceil(totalCount / limit),
    page,
    metrics: {
      total: numericCount(metrics?.total),
      open: numericCount(metrics?.open),
      resolved: numericCount(metrics?.resolved),
    },
    filters: { severity, status },
  };
}

export default async function DefectsPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet', href: '/dashboard/fleet' }, { label: 'Defects' }]} />
        <PageHeader title="Vehicle Defects" description="Track and manage vehicle issues across the fleet" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet', href: '/dashboard/fleet' }, { label: 'Defects' }]} />
        <PageHeader title="Vehicle Defects" description="Track and manage vehicle issues across the fleet" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Set the DATABASE_URL environment variable and run migrations." />
      </div>
    );
  }

  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/fleet/defects', roleNames);
  const canResolve = canPerformDashboardAction('/dashboard/fleet/defects', roleNames, 'update');
  const canViewInspections = canPerformDashboardAction('/dashboard/inspections', roleNames, 'view');
  let result: Awaited<ReturnType<typeof fetchDefects>>;
  try {
    result = await fetchDefects(
      sp,
      session.tenantId,
      session.user.id,
      access.recordScope ?? 'assigned',
    );
  } catch (error) {
    console.error('Defects query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet', href: '/dashboard/fleet' }, { label: 'Defects' }]} />
        <PageHeader title="Vehicle Defects" description="Track and manage vehicle issues across the fleet" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Defects" />
      </div>
    );
  }

  const metrics = [
    { label: 'Total Defects', value: result.metrics.total, tone: 'text-ink-950' },
    { label: 'Open', value: result.metrics.open, tone: 'text-status-error-text' },
    { label: 'Resolved', value: result.metrics.resolved, tone: 'text-status-success-text' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Fleet', href: '/dashboard/fleet' }, { label: 'Defects' }]} />
      <PageHeader title="Vehicle Defects" description="Operational defects, blocking conditions and resolution status">
        <Button variant="secondary" size="sm" asChild><Link href="/dashboard/fleet"><ChevronLeft className="h-4 w-4" aria-hidden="true" /> Back to Fleet</Link></Button>
      </PageHeader>

      <section aria-label="Defect summary" className="border-border grid grid-cols-1 gap-px overflow-hidden rounded-[10px] border bg-border sm:grid-cols-3">
        {metrics.map((metric) => (
          <div key={metric.label} className="bg-surface px-4 py-4 sm:px-5"><p className={`text-2xl font-semibold tabular-nums ${metric.tone}`}>{metric.value}</p><p className="text-ink-500 mt-0.5 text-xs">{metric.label}</p></div>
        ))}
      </section>

      <Card>
        <CardContent className="pt-4">
          <FilterToolbar resetHref="/dashboard/fleet/defects" isFiltered={hasActiveFilters(result.filters)}>
            <div className="w-full sm:w-[180px]"><label className="text-ink-500 mb-1 block text-xs font-medium">Status</label><StyledSelect name="status" defaultValue={result.filters.status ?? ''} placeholder="All Statuses"><option value="open">Open</option><option value="resolved">Resolved</option></StyledSelect></div>
            <div className="w-full sm:w-[180px]"><label className="text-ink-500 mb-1 block text-xs font-medium">Severity</label><StyledSelect name="severity" defaultValue={result.filters.severity ?? ''} placeholder="All Severities"><option value="critical">Critical</option><option value="major">Major</option><option value="minor">Minor</option><option value="informational">Informational</option></StyledSelect></div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {result.rows.length === 0 ? (
        <EmptyState icon={<AlertTriangle className="h-8 w-8" />} title="No defects found" description={hasActiveFilters(result.filters) ? 'No matching defects. Clear filters to view all records.' : 'There are no recorded defects in your current workspace scope.'} />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {result.rows.map((defect) => {
            const isOpen = !defect.resolvedAt;
            return (
              <article key={defect.id} className={`border-border border-b p-4 last:border-b-0 sm:p-5 ${isOpen && defect.isBlocking ? 'bg-status-error-bg/30' : ''}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className={`hidden h-9 w-9 shrink-0 items-center justify-center rounded-[8px] sm:flex ${isOpen ? 'bg-status-error-bg text-status-error-text' : 'bg-status-success-bg text-status-success-text'}`}>
                    {isOpen ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink-950 text-sm font-semibold">{defect.description}</p>
                    <div className="text-ink-500 mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="flex items-center gap-1"><Car className="h-3 w-3" aria-hidden="true" />{defect.vehicleMake} {defect.vehicleModel} ({defect.vehicleGrn})</span>
                      <span className="tabular-nums">{formatDate(defect.createdAt)}</span>
                      {defect.inspectionId && canViewInspections && <Link href={`/dashboard/inspections/${defect.inspectionId}`} className="text-brand-700 focus-ring inline-flex items-center gap-1 rounded hover:underline"><Eye className="h-3 w-3" aria-hidden="true" />View Inspection</Link>}
                    </div>
                    {defect.resolutionNotes && <p className="text-ink-500 mt-2 text-xs">Resolution: {defect.resolutionNotes}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <Badge variant={isOpen && defect.severity === 'critical' ? 'emergency' : defect.severity === 'major' ? 'error' : defect.severity === 'minor' ? 'pending' : 'info'} size="sm">{SEVERITY_LABELS[defect.severity] ?? defect.severity}</Badge>
                    {defect.isBlocking && <StatusBadge status="error" label="Blocking" />}
                    <StatusBadge status={isOpen ? 'error' : 'success'} label={isOpen ? 'Open' : 'Resolved'} />
                    {isOpen && canResolve && <DefectResolveButton defectId={defect.id} />}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {result.totalPages > 1 && (
        <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-ink-500 text-xs">Page {result.page} of {result.totalPages}</p>
          <div className="flex items-center gap-2">
            {result.page > 1 && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/fleet/defects', sp, { page: String(result.page - 1) })}><ChevronLeft className="h-3 w-3" aria-hidden="true" /> Previous</Link></Button>}
            {result.page < result.totalPages && <Button variant="secondary" size="sm" asChild><Link href={buildFilterUrl('/dashboard/fleet/defects', sp, { page: String(result.page + 1) })}>Next <ChevronRight className="h-3 w-3" aria-hidden="true" /></Link></Button>}
          </div>
        </div>
      )}
    </div>
  );
}
