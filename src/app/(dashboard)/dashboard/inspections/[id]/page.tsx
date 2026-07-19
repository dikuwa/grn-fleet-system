import { getDb, isDbConnected } from '@/db';
import { vehicleInspections, inspectionItemResults, inspectionTemplateItems, inspectionPhotos } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { eq, and, desc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Database, ChevronLeft, ClipboardCheck, Truck, Gauge, CheckCircle2, XCircle,
  AlertTriangle, Camera, FileText,
} from 'lucide-react';
import { formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

const CATEGORY_LABELS: Record<string, string> = {
  exterior: 'Exterior',
  tyres: 'Tyres & Wheels',
  lights: 'Lights & Indicators',
  interior: 'Interior',
  documents: 'Documents',
  safety: 'Safety Equipment',
  equipment: 'Equipment',
};

async function fetchInspectionDetail(id: string, tenantId: string) {
  const db = getDb();

  const [inspection] = await db
    .select({
      id: vehicleInspections.id,
      type: vehicleInspections.type,
      status: vehicleInspections.status,
      overallPass: vehicleInspections.overallPass,
      odometerReading: vehicleInspections.odometerReading,
      fuelLevel: vehicleInspections.fuelLevel,
      notes: vehicleInspections.notes,
      createdAt: vehicleInspections.createdAt,
      updatedAt: vehicleInspections.updatedAt,
      tripId: vehicleInspections.tripId,
      make: vehicles.make,
      model: vehicles.model,
      licenceNumber: vehicles.licenceNumber,
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

  if (!inspection) notFound();

  const checklistItems = await db
    .select({
      id: inspectionItemResults.id,
      result: inspectionItemResults.result,
      comment: inspectionItemResults.comment,
      category: inspectionTemplateItems.category,
      label: inspectionTemplateItems.label,
      isCritical: inspectionTemplateItems.isCritical,
    })
    .from(inspectionItemResults)
    .leftJoin(
      inspectionTemplateItems,
      eq(inspectionItemResults.templateItemId, inspectionTemplateItems.id),
    )
    .where(eq(inspectionItemResults.inspectionId, id))
    .orderBy(inspectionTemplateItems.sortOrder);

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

  return { inspection, checklistItems, photos };
}

export default async function InspectionDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections', href: '/dashboard/inspections' }, { label: 'Inspection Detail' }]} />
        <PageHeader title="Inspection Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections', href: '/dashboard/inspections' }, { label: 'Inspection Detail' }]} />
        <PageHeader title="Inspection Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchInspectionDetail>>;
  try {
    data = await fetchInspectionDetail(id, session.tenantId);
  } catch (error) {
    console.error('Inspection detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Inspections', href: '/dashboard/inspections' }, { label: 'Inspection Detail' }]} />
        <PageHeader title="Inspection Detail" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Inspection" />
      </div>
    );
  }

  const { inspection, checklistItems, photos } = data;

  const passedItems = checklistItems.filter((i) => i.result === 'pass');
  const failedItems = checklistItems.filter((i) => i.result === 'fail');
  const criticalFails = checklistItems.filter((i) => i.isCritical && i.result === 'fail');

  // Group checklist by category
  const grouped = checklistItems.reduce(
    (acc, item) => {
      const cat = item.category || 'other';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {} as Record<string, typeof checklistItems>,
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Inspections', href: '/dashboard/inspections' },
        { label: `${inspection.type} Inspection` },
      ]} />
      <PageHeader
        title={`${inspection.type === 'departure' ? 'Departure' : 'Return'} Inspection`}
        description={`${inspection.make} ${inspection.model} · ${inspection.licenceNumber}`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/inspections"><ChevronLeft className="h-4 w-4" /> Back to Inspections</Link>
        </Button>
      </PageHeader>

      {/* Overview Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] ${
              inspection.overallPass === true ? 'bg-status-success-bg text-status-success-text' :
              inspection.overallPass === false ? 'bg-status-error-bg text-status-error-text' :
              'bg-muted text-ink-500'
            }`}>
              <ClipboardCheck className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950 capitalize">{inspection.type} Inspection</h2>
                <Badge variant={inspection.status === 'completed' ? 'success' : inspection.status === 'failed' ? 'error' : 'pending'} size="sm">
                  {inspection.status?.replace(/_/g, ' ')}
                </Badge>
                {inspection.overallPass != null && (
                  <Badge variant={inspection.overallPass ? 'success' : 'error'} size="sm">
                    {inspection.overallPass ? 'Pass' : 'Fail'}
                  </Badge>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="flex items-center gap-1"><Truck className="h-3.5 w-3.5" />{inspection.make} {inspection.model}</span>
                <span className="flex items-center gap-1"><Gauge className="h-3.5 w-3.5" />{inspection.odometerReading?.toLocaleString()} km</span>
                {inspection.fuelLevel && <span>Fuel: {inspection.fuelLevel.replace(/_/g, ' ')}</span>}
                <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{formatDateTime(inspection.createdAt)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-[650] tabular-nums text-status-success-text">{passedItems.length}</p>
          <p className="text-xs text-ink-500">Passed</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-[650] tabular-nums text-status-error-text">{failedItems.length}</p>
          <p className="text-xs text-ink-500">Failed</p>
        </CardContent></Card>
        <Card><CardContent className="pt-4 text-center">
          <p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{criticalFails.length}</p>
          <p className="text-xs text-ink-500">Critical Fails</p>
        </CardContent></Card>
      </div>

      {/* Checklist by Category */}
      {Object.entries(grouped).map(([category, items]) => {
        const catFails = items.filter((i) => i.result === 'fail').length;
        return (
          <Card key={category}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {CATEGORY_LABELS[category] ?? category}
                {catFails > 0 && (
                  <Badge variant="error" size="sm">{catFails} fail{catFails > 1 ? 's' : ''}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className={`flex items-start justify-between rounded-[8px] border p-3 ${
                  item.result === 'fail' ? 'border-status-error-bg/40 bg-status-error-bg/10' :
                  item.result === 'pass' ? 'border-status-success-bg/40 bg-status-success-bg/10' :
                  'border-border'
                }`}>
                  <div className="flex items-start gap-2 min-w-0">
                    <div className="mt-0.5">
                      {item.result === 'pass' ? (
                        <CheckCircle2 className="h-4 w-4 text-status-success-text shrink-0" />
                      ) : item.result === 'fail' ? (
                        <XCircle className="h-4 w-4 text-status-error-text shrink-0" />
                      ) : (
                        <span className="block h-4 w-4 rounded-full border-2 border-ink-300 shrink-0" />
                      )}
                    </div>
                    <div>
                      <span className="text-sm text-ink-700">{item.label}</span>
                      {item.isCritical && (
                        <AlertTriangle className="inline h-3.5 w-3.5 ml-1 text-status-emergency-text" />
                      )}
                      {item.comment && (
                        <p className="text-xs text-ink-500 mt-0.5">{item.comment}</p>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs font-medium shrink-0 ml-2 ${
                    item.result === 'pass' ? 'text-status-success-text' :
                    item.result === 'fail' ? 'text-status-error-text' :
                    'text-ink-400'
                  }`}>
                    {item.result === 'pass' ? 'Pass' : item.result === 'fail' ? 'Fail' : 'N/A'}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}

      {/* Photos */}
      {photos.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Photos ({photos.length})</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {photos.map((photo) => (
                <div key={photo.id} className="rounded-[8px] border border-border overflow-hidden">
                  <div className="aspect-video bg-muted flex items-center justify-center">
                    <Camera className="h-8 w-8 text-ink-300" />
                  </div>
                  {photo.caption && (
                    <div className="px-3 py-2">
                      <p className="text-xs text-ink-500">{photo.caption}</p>
                      <p className="text-[11px] text-ink-400 mt-0.5">{formatDateTime(photo.capturedAt)}</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {inspection.notes && (
        <Card>
          <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-ink-700 whitespace-pre-wrap">{inspection.notes}</p>
          </CardContent>
        </Card>
      )}

      {/* Trip Link */}
      {inspection.tripId && (
        <Card>
          <CardContent className="pt-4">
            <Button variant="secondary" size="sm" asChild>
              <Link href={`/dashboard/trips/${inspection.tripId}`}>
                <Truck className="h-4 w-4" /> View Related Trip
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
