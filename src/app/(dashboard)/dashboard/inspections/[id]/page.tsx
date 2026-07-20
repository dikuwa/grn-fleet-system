import { getDb, isDbConnected } from '@/db';
import {
  vehicleInspections,
  inspectionItemResults,
  inspectionTemplateItems,
  inspectionPhotos,
} from '@/db/schema/trips';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { trips } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { getServerSession } from '@/lib/session';
import { eq, and, desc } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ClipboardCheck,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Truck,
  Calendar,
  Gauge,
  Fuel,
  FileText,
  ArrowLeft,
  Database,
  Camera,
} from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';

interface PageProps {
  params: Promise<{ id: string }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  exterior: 'Exterior',
  interior: 'Interior',
  tyres: 'Tyres & Wheels',
  lights: 'Lights & Electrical',
  documents: 'Documents & Compliance',
  safety: 'Safety Equipment',
  fuel: 'Fuel',
};

const FUEL_LEVEL_LABELS: Record<string, string> = {
  full: 'Full',
  three_quarters: '¾',
  half: '½',
  quarter: '¼',
  empty: 'Empty',
};

async function fetchInspectionDetail(id: string, tenantId: string) {
  const db = getDb();

  const [inspection] = await db
    .select({
      id: vehicleInspections.id,
      vehicleId: vehicleInspections.vehicleId,
      tripId: vehicleInspections.tripId,
      type: vehicleInspections.type,
      odometerReading: vehicleInspections.odometerReading,
      fuelLevel: vehicleInspections.fuelLevel,
      status: vehicleInspections.status,
      overallPass: vehicleInspections.overallPass,
      notes: vehicleInspections.notes,
      createdAt: vehicleInspections.createdAt,
      updatedAt: vehicleInspections.updatedAt,
      inspectorUserId: vehicleInspections.inspectorUserId,
      make: vehicles.make,
      model: vehicles.model,
      licenceNumber: vehicles.licenceNumber,
      vehicleStatus: vehicles.status,
    })
    .from(vehicleInspections)
    .leftJoin(vehicles, eq(vehicleInspections.vehicleId, vehicles.id))
    .where(
      and(
        eq(vehicleInspections.id, id),
        eq(vehicleInspections.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!inspection) return null;

  // Fetch checklist results ordered by category
  const results = await db
    .select({
      id: inspectionItemResults.id,
      result: inspectionItemResults.result,
      comment: inspectionItemResults.comment,
      defectId: inspectionItemResults.defectId,
      category: inspectionTemplateItems.category,
      label: inspectionTemplateItems.label,
      sortOrder: inspectionTemplateItems.sortOrder,
      isCritical: inspectionTemplateItems.isCritical,
    })
    .from(inspectionItemResults)
    .leftJoin(
      inspectionTemplateItems,
      eq(inspectionItemResults.templateItemId, inspectionTemplateItems.id),
    )
    .where(eq(inspectionItemResults.inspectionId, id))
    .orderBy(
      inspectionTemplateItems.category,
      inspectionTemplateItems.sortOrder,
    );

  // Fetch photos
  const photos = await db
    .select({
      id: inspectionPhotos.id,
      fileKey: inspectionPhotos.fileKey,
      caption: inspectionPhotos.caption,
      capturedAt: inspectionPhotos.capturedAt,
    })
    .from(inspectionPhotos)
    .where(eq(inspectionPhotos.inspectionId, id))
    .orderBy(inspectionPhotos.capturedAt);

  // Fetch defects created from this inspection
  const defects = await db
    .select({
      id: vehicleDefects.id,
      severity: vehicleDefects.severity,
      description: vehicleDefects.description,
      isBlocking: vehicleDefects.isBlocking,
      resolvedAt: vehicleDefects.resolvedAt,
      createdAt: vehicleDefects.createdAt,
    })
    .from(vehicleDefects)
    .where(eq(vehicleDefects.inspectionId, id))
    .orderBy(desc(vehicleDefects.createdAt));

  // Fetch trip info if linked
  let tripInfo: { id: string; status: string; startedAt: Date | null; returnedAt: Date | null } | null = null;
  if (inspection.tripId) {
    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        startedAt: trips.startedAt,
        returnedAt: trips.returnedAt,
      })
      .from(trips)
      .where(eq(trips.id, inspection.tripId))
      .limit(1);
    tripInfo = trip || null;
  }

  // Group results by category
  const groupedResults = results.reduce(
    (acc, r) => {
      const cat = r.category || 'uncategorized';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(r);
      return acc;
    },
    {} as Record<string, typeof results>,
  );

  const passCount = results.filter((r) => r.result === 'pass').length;
  const failCount = results.filter((r) => r.result === 'fail').length;
  const naCount = results.filter((r) => r.result === 'not_applicable').length;
  const criticalFails = results.filter(
    (r) => r.result === 'fail' && r.isCritical,
  ).length;

  return {
    inspection,
    groupedResults,
    photos,
    defects,
    tripInfo,
    passCount,
    failCount,
    naCount,
    criticalFails,
  };
}

export default async function InspectionDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections', href: '/dashboard/inspections' }, { label: 'Inspection' }]} />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view this inspection." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections', href: '/dashboard/inspections' }, { label: 'Inspection' }]} />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchInspectionDetail>>;
  try {
    data = await fetchInspectionDetail(id, session.tenantId);
  } catch (error) {
    console.error('[InspectionDetail] Query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections', href: '/dashboard/inspections' }, { label: 'Inspection' }]} />
        <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="Unable to Load Inspection" />
      </div>
    );
  }

  if (!data) notFound();

  const { inspection, groupedResults, photos, defects, tripInfo, passCount, failCount, naCount, criticalFails } = data;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Inspections', href: '/dashboard/inspections' },
          { label: `${inspection.type.charAt(0).toUpperCase() + inspection.type.slice(1)} Inspection` },
        ]}
      />
      <PageHeader
        title={`${inspection.type.charAt(0).toUpperCase() + inspection.type.slice(1)} Inspection`}
        description={`${inspection.make} ${inspection.model} · ${inspection.licenceNumber}`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections">
            <ArrowLeft className="h-4 w-4" />
            Back to Inspections
          </Link>
        </Button>
        {tripInfo && (
          <Button variant="secondary" size="sm" asChild>
            <Link href={`/dashboard/trips/${tripInfo.id}`}>
              <FileText className="h-4 w-4" />
              View Trip
            </Link>
          </Button>
        )}
      </PageHeader>

      {/* Status & Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Status</p>
                <Badge
                  variant={inspection.status === 'completed' ? 'success' : inspection.status === 'failed' ? 'error' : 'pending'}
                  size="sm"
                  className="mt-1"
                >
                  {inspection.status?.replace(/_/g, ' ')}
                </Badge>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                inspection.overallPass === true
                  ? 'bg-status-success-bg text-status-success-text'
                  : inspection.overallPass === false
                    ? 'bg-status-error-bg text-status-error-text'
                    : 'bg-muted text-ink-500'
              }`}>
                {inspection.overallPass === true ? (
                  <CheckCircle2 className="h-5 w-5" />
                ) : (
                  <XCircle className="h-5 w-5" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-ink-500">Inspection Type</p>
            <p className="mt-1 text-sm font-[650] text-ink-950 capitalize">{inspection.type}</p>
            <p className="text-xs text-ink-500 tabular-nums">{formatDate(inspection.createdAt)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-ink-500">Vehicle</p>
            <Link href={`/dashboard/fleet/${inspection.vehicleId}`} className="mt-1 block text-sm font-[650] text-brand-700 hover:underline">
              {inspection.make} {inspection.model}
            </Link>
            <p className="text-xs text-ink-500 tabular-nums">{inspection.licenceNumber}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-ink-500">Checklist</p>
            <p className="mt-1 text-sm text-ink-950">
              <span className="text-status-success-text">{passCount} passed</span>
              {failCount > 0 && <span className="text-status-error-text"> · {failCount} failed</span>}
              {naCount > 0 && <span className="text-ink-500"> · {naCount} N/A</span>}
            </p>
            {criticalFails > 0 && (
              <p className="text-xs text-status-error-text mt-0.5 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" />
                {criticalFails} critical
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Vehicle & Trip Details */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Truck className="h-4 w-4" /> Vehicle Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-ink-500">Licence</p>
                <p className="text-sm font-medium text-ink-950">{inspection.licenceNumber}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500">Vehicle Status</p>
                <Badge variant={inspection.vehicleStatus === 'available' ? 'success' : 'pending'} size="sm">
                  {inspection.vehicleStatus?.replace(/_/g, ' ')}
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-ink-500">Odometer</p>
                <p className="text-sm font-medium text-ink-950 tabular-nums flex items-center gap-1.5">
                  <Gauge className="h-3.5 w-3.5 text-ink-400" />
                  {inspection.odometerReading?.toLocaleString() ?? '—'} km
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-500">Fuel Level</p>
                <p className="text-sm font-medium text-ink-950 flex items-center gap-1.5">
                  <Fuel className="h-3.5 w-3.5 text-ink-400" />
                  {inspection.fuelLevel ? (FUEL_LEVEL_LABELS[inspection.fuelLevel] ?? inspection.fuelLevel) : '—'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {tripInfo ? (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Linked Trip</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-ink-500">Trip Status</p>
                  <Badge
                    variant={tripInfo.status === 'closed' ? 'success' : tripInfo.status === 'in_progress' ? 'info' : 'pending'}
                    size="sm"
                  >
                    {tripInfo.status?.replace(/_/g, ' ')}
                  </Badge>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-ink-500">Started</p>
                  <p className="text-sm font-medium text-ink-950 tabular-nums">
                    {tripInfo.startedAt ? formatDate(tripInfo.startedAt) : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-500">Returned</p>
                  <p className="text-sm font-medium text-ink-950 tabular-nums">
                    {tripInfo.returnedAt ? formatDate(tripInfo.returnedAt) : '—'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Calendar className="h-4 w-4" /> Trip</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-ink-500">No trip linked to this inspection</p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Checklist Results */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Checklist Results</span>
            <div className="flex items-center gap-2">
              <Badge variant="success" size="sm">{passCount} Pass</Badge>
              {failCount > 0 && <Badge variant="error" size="sm">{failCount} Fail</Badge>}
              {naCount > 0 && <Badge variant="info" size="sm">{naCount} N/A</Badge>}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {Object.keys(groupedResults).length === 0 ? (
            <p className="text-sm text-ink-500">No checklist items recorded for this inspection.</p>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedResults).map(([category, items]) => (
                <div key={category}>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-400">
                    {CATEGORY_LABELS[category] ?? category}
                  </h4>
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div
                        key={item.id}
                        className={`rounded-[8px] border p-3 ${
                          item.result === 'fail'
                            ? 'border-status-error-bg/40 bg-status-error-bg/10'
                            : item.result === 'pass'
                              ? 'border-status-success-bg/30 bg-status-success-bg/5'
                              : 'border-border bg-surface'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            {item.result === 'pass' ? (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success-text" />
                            ) : item.result === 'fail' ? (
                              <XCircle className="h-4 w-4 shrink-0 text-status-error-text" />
                            ) : (
                              <span className="h-4 w-4 shrink-0 rounded-[3px] border border-border bg-muted" />
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-ink-950">{item.label}</p>
                                {item.isCritical && (
                                  <Badge variant="emergency" size="sm">Critical</Badge>
                                )}
                              </div>
                              {item.comment && (
                                <p className="mt-0.5 text-xs text-ink-500">{item.comment}</p>
                              )}
                            </div>
                          </div>
                          <Badge
                            variant={item.result === 'pass' ? 'success' : item.result === 'fail' ? 'error' : 'info'}
                            size="sm"
                          >
                            {item.result === 'not_applicable' ? 'N/A' : item.result.charAt(0).toUpperCase() + item.result.slice(1)}
                          </Badge>
                        </div>
                        {item.defectId && (
                          <Link
                            href={`/dashboard/fleet/defects?defectId=${item.defectId}`}
                            className="mt-2 inline-flex items-center gap-1 text-xs text-status-error-text hover:underline"
                          >
                            <AlertTriangle className="h-3 w-3" />
                            View associated defect
                          </Link>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Defects */}
      {defects.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-status-error-text" />
              Vehicle Defects ({defects.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {defects.map((defect) => (
              <div key={defect.id} className="rounded-[8px] border border-border bg-surface p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink-950">{defect.description}</p>
                      <Badge
                        variant={defect.severity === 'critical' ? 'emergency' : defect.severity === 'major' ? 'error' : 'pending'}
                        size="sm"
                      >
                        {defect.severity}
                      </Badge>
                      {defect.isBlocking && (
                        <Badge variant="emergency" size="sm">Blocking</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-ink-500 tabular-nums">
                      Reported {formatDate(defect.createdAt)}
                    </p>
                  </div>
                  <Badge variant={defect.resolvedAt ? 'success' : 'pending'} size="sm">
                    {defect.resolvedAt ? 'Resolved' : 'Open'}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Photos */}
      {photos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Camera className="h-4 w-4 text-ink-500" />
              Photos ({photos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {photos.map((photo) => (
                <div key={photo.id} className="rounded-[8px] border border-border overflow-hidden">
                  <div className="aspect-video bg-muted flex items-center justify-center">
                    <Camera className="h-8 w-8 text-ink-300" />
                  </div>
                  <div className="p-2">
                    <p className="text-xs text-ink-500 truncate">{photo.caption || 'No caption'}</p>
                    <p className="text-xs text-ink-400 tabular-nums">{formatDate(photo.capturedAt)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {inspection.notes && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-ink-950 whitespace-pre-wrap">{inspection.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Bottom Actions */}
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections">
            <ArrowLeft className="h-4 w-4" />
            Back to Inspections
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href={`/dashboard/fleet/${inspection.vehicleId}`}>
            <Truck className="h-4 w-4" />
            View Vehicle
          </Link>
        </Button>
      </div>
    </div>
  );
}
