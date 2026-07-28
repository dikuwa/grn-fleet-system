import { getDb, isDbConnected } from '@/db';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { eq, desc, isNull, isNotNull, and, sql, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StyledSelect } from '@/components/ui/styled-select';
import { Database } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import { AlertTriangle, ChevronLeft, ChevronRight, Car, CheckCircle2, Eye } from 'lucide-react';
import Link from 'next/link';
import { DefectResolveButton } from './DefectResolveButton';
import { getServerSession } from '@/lib/session';
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { canPerformDashboardAction } from '@/lib/dashboard-access';
import { FilterToolbar } from '@/components/ui/filter-toolbar';
import { buildFilterUrl, hasActiveFilters, normalizeOptionalFilter } from '@/lib/filter-state';
import { numericCount } from '@/lib/statistics';

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

async function fetchDefects(sp: Record<string, string | undefined>, tenantId: string) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const severity = normalizeOptionalFilter(sp.severity);
  const status = normalizeOptionalFilter(sp.status);

  const baseConditions: SQL[] = [eq(vehicles.tenantId, tenantId)];
  const baseWhere = and(...baseConditions);
  const conditions = [...baseConditions];

  if (status === 'open') {
    conditions.push(isNull(vehicleDefects.resolvedAt));
  } else if (status === 'resolved') {
    conditions.push(isNotNull(vehicleDefects.resolvedAt));
  }

  if (severity) {
    conditions.push(eq(vehicleDefects.severity, severity));
  }

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

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);

  // Sort by severity order
  rows.sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity] ?? 99;
    const bOrder = SEVERITY_ORDER[b.severity] ?? 99;
    return aOrder - bOrder;
  });
  const metrics = metricResult[0];

  return {
    rows,
    totalCount,
    totalPages,
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
  if (!session) return null;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Fleet', href: '/dashboard/fleet' },
            { label: 'Defects' },
          ]}
        />
        <PageHeader
          title="Vehicle Defects"
          description="Track and manage vehicle issues across the fleet"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations."
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchDefects>>;
  const roleNames = await getSessionRoleNames(session);
  const canResolve = canPerformDashboardAction('/dashboard/fleet/defects', roleNames, 'update');
  try {
    result = await fetchDefects(sp, session.tenantId);
  } catch (error) {
    console.error('Defects query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Fleet', href: '/dashboard/fleet' },
            { label: 'Defects' },
          ]}
        />
        <PageHeader
          title="Vehicle Defects"
          description="Track and manage vehicle issues across the fleet"
        />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Defects"
          description="The database query failed. Please run migrations and seed first."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: 'Defects' },
        ]}
      />
      <PageHeader
        title="Vehicle Defects"
        description="Track and manage vehicle issues across the fleet"
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fleet">
            <ChevronLeft className="h-4 w-4" />
            Back to Fleet
          </Link>
        </Button>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-ink-950 text-2xl font-[650] tabular-nums">
                {result.metrics.total}
              </p>
              <p className="text-ink-500 text-xs">Total Defects</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-status-error-text text-2xl font-[650] tabular-nums">
                {result.metrics.open}
              </p>
              <p className="text-ink-500 text-xs">Open</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-status-success-text text-2xl font-[650] tabular-nums">
                {result.metrics.resolved}
              </p>
              <p className="text-ink-500 text-xs">Resolved</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <FilterToolbar
            resetHref="/dashboard/fleet/defects"
            isFiltered={hasActiveFilters(result.filters)}
          >
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Status</label>
              <StyledSelect
                name="status"
                defaultValue={result.filters.status ?? ''}
                placeholder="All Statuses"
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
              </StyledSelect>
            </div>
            <div className="w-[180px]">
              <label className="text-ink-500 mb-1 block text-xs font-medium">Severity</label>
              <StyledSelect
                name="severity"
                defaultValue={result.filters.severity ?? ''}
                placeholder="All Severities"
              >
                <option value="critical">Critical</option>
                <option value="major">Major</option>
                <option value="minor">Minor</option>
                <option value="informational">Informational</option>
              </StyledSelect>
            </div>
          </FilterToolbar>
        </CardContent>
      </Card>

      {/* Defects List */}
      {result.rows.length === 0 ? (
        <EmptyState
          icon={<AlertTriangle className="h-8 w-8" />}
          title="No defects found"
          description="There are no recorded defects matching the current filters."
        />
      ) : (
        <div className="space-y-3">
          {result.rows.map((defect) => {
            const isOpen = !defect.resolvedAt;
            return (
              <div
                key={defect.id}
                className={`border-border bg-surface rounded-[10px] border p-4 ${
                  isOpen && defect.isBlocking
                    ? 'border-status-error-bg/50 bg-status-error-bg/10'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  {' '}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] ${
                          isOpen
                            ? 'bg-status-error-bg text-status-error-text'
                            : 'bg-status-success-bg text-status-success-text'
                        }`}
                      >
                        {isOpen ? (
                          <AlertTriangle className="h-4 w-4" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="text-ink-950 text-sm font-medium">{defect.description}</p>
                        <div className="text-ink-500 mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                          <span className="flex items-center gap-1">
                            <Car className="h-3 w-3" />
                            {defect.vehicleMake} {defect.vehicleModel} ({defect.vehicleGrn})
                          </span>
                          <span>&middot;</span>
                          <span>{formatDate(defect.createdAt)}</span>
                          {defect.inspectionId && (
                            <>
                              <span>&middot;</span>
                              <Link
                                href={`/dashboard/inspections/${defect.inspectionId}`}
                                className="text-brand-600 hover:text-brand-700 flex items-center gap-1 underline underline-offset-2"
                              >
                                <Eye className="h-3 w-3" /> View Inspection
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    {defect.resolutionNotes && (
                      <p className="text-ink-500 mt-2 ml-10 text-xs">
                        Resolution: {defect.resolutionNotes}
                      </p>
                    )}
                  </div>{' '}
                  <div className="flex shrink-0 items-start gap-2">
                    <Badge
                      variant={
                        isOpen && defect.severity === 'critical'
                          ? 'emergency'
                          : defect.severity === 'major'
                            ? 'error'
                            : defect.severity === 'minor'
                              ? 'pending'
                              : 'info'
                      }
                      size="sm"
                    >
                      {SEVERITY_LABELS[defect.severity] ?? defect.severity}
                    </Badge>
                    {defect.isBlocking && <StatusBadge status="error" label="Blocking" />}
                    <StatusBadge
                      status={isOpen ? 'error' : 'success'}
                      label={isOpen ? 'Open' : 'Resolved'}
                    />
                    {isOpen && canResolve && <DefectResolveButton defectId={defect.id} />}
                  </div>
                </div>
              </div>
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
                  href={buildFilterUrl('/dashboard/fleet/defects', sp, {
                    page: String(result.page - 1),
                  })}
                >
                  <ChevronLeft className="h-3 w-3" />
                  Previous
                </Link>
              </Button>
            )}
            {result.page < result.totalPages && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildFilterUrl('/dashboard/fleet/defects', sp, {
                    page: String(result.page + 1),
                  })}
                >
                  Next
                  <ChevronRight className="h-3 w-3" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
