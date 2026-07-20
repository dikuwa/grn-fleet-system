import { getDb, isDbConnected } from '@/db';
import { vehicleDefects, vehicles } from '@/db/schema/fleet';
import { eq, desc, isNull, isNotNull, and, sql, type SQL } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database } from 'lucide-react';
import { DEFAULT_PAGE_SIZE } from '@/lib/constants';
import { formatDate } from '@/lib/utils';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Search,
  Car,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import Link from 'next/link';
import { DefectResolveButton } from './DefectResolveButton';

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

async function fetchDefects(sp: Record<string, string | undefined>) {
  const db = getDb();
  const page = Math.max(1, Number(sp.page) || 1);
  const limit = DEFAULT_PAGE_SIZE;
  const offset = (page - 1) * limit;
  const severity = sp.severity?.trim();
  const status = sp.status?.trim();

  const conditions: SQL[] = [];

  if (status === 'open') {
    conditions.push(isNull(vehicleDefects.resolvedAt));
  } else if (status === 'resolved') {
    conditions.push(isNotNull(vehicleDefects.resolvedAt));
  }

  if (severity) {
    conditions.push(eq(vehicleDefects.severity, severity));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, totalResult] = await Promise.all([
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
      .where(where),
  ]);

  const totalCount = Number(totalResult[0]?.count ?? 0);
  const totalPages = Math.ceil(totalCount / limit);

  // Sort by severity order
  rows.sort((a, b) => {
    const aOrder = SEVERITY_ORDER[a.severity] ?? 99;
    const bOrder = SEVERITY_ORDER[b.severity] ?? 99;
    return aOrder - bOrder;
  });

  return {
    rows,
    totalCount,
    totalPages,
    page,
    filters: { severity, status: status ?? 'open' },
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

export default async function DefectsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: 'Defects' },
        ]} />
        <PageHeader title="Vehicle Defects" description="Track and manage vehicle issues across the fleet" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations."
        />
      </div>
    );
  }

  let result: Awaited<ReturnType<typeof fetchDefects>>;
  try {
    result = await fetchDefects(sp);
  } catch (error) {
    console.error('Defects query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: 'Defects' },
        ]} />
        <PageHeader title="Vehicle Defects" description="Track and manage vehicle issues across the fleet" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Defects"
          description="The database query failed. Please run migrations and seed first."
        />
      </div>
    );
  }

  const openCount = result.rows.filter((r) => !r.resolvedAt).length;
  const resolvedCount = result.rows.filter((r) => r.resolvedAt).length;

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
              <p className="text-2xl font-[650] tabular-nums text-ink-950">
                {result.totalCount}
              </p>
              <p className="text-xs text-ink-500">Total Defects</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-error-text">
                {openCount}
              </p>
              <p className="text-xs text-ink-500">Open</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-center">
              <p className="text-2xl font-[650] tabular-nums text-status-success-text">
                {resolvedCount}
              </p>
              <p className="text-xs text-ink-500">Resolved</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <form className="flex flex-wrap items-end gap-4 filter-bar-mobile">
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">
                Status
              </label>
              <select
                name="status"
                defaultValue={result.filters.status}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="open">Open</option>
                <option value="resolved">Resolved</option>
                <option value="">All</option>
              </select>
            </div>
            <div className="w-[180px]">
              <label className="block text-xs font-medium text-ink-500 mb-1">
                Severity
              </label>
              <select
                name="severity"
                defaultValue={result.filters.severity ?? ''}
                className="h-10 w-full rounded-[8px] border border-border bg-surface px-3 text-sm text-ink-950 focus:outline-none focus:ring-2 focus:ring-brand-200"
              >
                <option value="">All Severities</option>
                <option value="critical">Critical</option>
                <option value="major">Major</option>
                <option value="minor">Minor</option>
                <option value="informational">Informational</option>
              </select>
            </div>
            <Button variant="primary" size="sm" type="submit">
              <Search className="h-4 w-4" />
              Filter
            </Button>
          </form>
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
                className={`rounded-[10px] border border-border bg-surface p-4 ${
                  isOpen && defect.isBlocking
                    ? 'border-status-error-bg/50 bg-status-error-bg/10'
                    : ''
                }`}
              >
                <div className="flex items-start justify-between gap-4">                    <div className="min-w-0 flex-1">
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
                          <p className="text-sm font-medium text-ink-950">
                            {defect.description}
                          </p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-ink-500">
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
                                  className="flex items-center gap-1 text-brand-600 hover:text-brand-700 underline underline-offset-2"
                                >
                                  <Eye className="h-3 w-3" /> View Inspection
                                </Link>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                      {defect.resolutionNotes && (
                        <p className="mt-2 text-xs text-ink-500 ml-10">
                          Resolution: {defect.resolutionNotes}
                        </p>
                      )}
                    </div>                    <div className="flex shrink-0 items-start gap-2">
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
                      {defect.isBlocking && (
                        <StatusBadge status="error" label="Blocking" />
                      )}
                      <StatusBadge
                        status={isOpen ? 'error' : 'success'}
                        label={isOpen ? 'Open' : 'Resolved'}
                      />
                      {isOpen && (
                        <DefectResolveButton defectId={defect.id} />
                      )}
                    </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {result.totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4">
          <p className="text-xs text-ink-500">
            Page {result.page} of {result.totalPages}
          </p>
          <div className="flex items-center gap-2">
            {result.page > 1 && (
              <Button variant="secondary" size="sm" asChild>
                <Link
                  href={buildPageUrl('/dashboard/fleet/defects', {
                    ...sp,
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
                  href={buildPageUrl('/dashboard/fleet/defects', {
                    ...sp,
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
