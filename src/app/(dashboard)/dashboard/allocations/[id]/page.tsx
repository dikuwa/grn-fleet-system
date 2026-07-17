import { getDb, isDbConnected } from '@/db';
import { vehicleAllocations, trips, tripAuthorities } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { eq } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database, Truck, ChevronLeft, CalendarDays, User, FileText, Gauge, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/utils';
import { notFound } from 'next/navigation';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

const ALLOCATION_STATE_LABELS: Record<string, string> = {
  provisional: 'Provisional', confirmed: 'Confirmed', cancelled: 'Cancelled', released: 'Released',
};
const ALLOCATION_STATE_VARIANTS: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'> = {
  provisional: 'pending', confirmed: 'info', cancelled: 'cancelled', released: 'success',
};

async function fetchAllocationDetail(id: string) {
  const db = getDb();

  const allocation = await db
    .select({
      id: vehicleAllocations.id,
      state: vehicleAllocations.state,
      startAt: vehicleAllocations.startAt,
      endAt: vehicleAllocations.endAt,
      recommendationScore: vehicleAllocations.recommendationScore,
      overrideReason: vehicleAllocations.overrideReason,
      createdAt: vehicleAllocations.createdAt,
      allocatedByUserId: vehicleAllocations.allocatedByUserId,
      vehicleId: vehicleAllocations.vehicleId,
      requestId: vehicleAllocations.requestId,
      make: vehicles.make,
      model: vehicles.model,
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      currentOdometer: vehicles.currentOdometer,
      vehicleStatus: vehicles.status,
      requestReference: transportRequests.reference,
      requestScope: transportRequests.scope,
      requestStatus: transportRequests.status,
      requestPurpose: transportRequests.purpose,
      requesterFirstName: employees.firstName,
      requesterLastName: employees.lastName,
    })
    .from(vehicleAllocations)
    .leftJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
    .leftJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
    .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
    .where(eq(vehicleAllocations.id, id))
    .then((r) => r[0] ?? null);

  if (!allocation) notFound();

  const [relatedTrip, authority, openDefects] = await Promise.all([
    db
      .select({
        id: trips.id,
        status: trips.status,
        startedAt: trips.startedAt,
        returnedAt: trips.returnedAt,
      })
      .from(trips)
      .where(eq(trips.allocationId, id))
      .then((r) => r[0] ?? null),
    db
      .select({
        id: tripAuthorities.id,
        releaseReference: tripAuthorities.releaseReference,
        authorisationReference: tripAuthorities.authorisationReference,
        specialAuthorityGranted: tripAuthorities.specialAuthorityGranted,
      })
      .from(tripAuthorities)
      .where(eq(tripAuthorities.allocationId, id))
      .then((r) => r[0] ?? null),
    db
      .select({ count: vehicleDefects.id })
      .from(vehicleDefects)
      .where(eq(vehicleDefects.vehicleId, allocation.vehicleId)),
  ]);

  return { allocation, relatedTrip, authority, openDefectCount: openDefects.length };
}

export default async function AllocationDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations', href: '/dashboard/allocations' }, { label: 'Allocation Detail' }]} />
        <PageHeader title="Allocation Detail" description="Allocation could not be loaded" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchAllocationDetail>>;
  try {
    data = await fetchAllocationDetail(id);
  } catch (error) {
    console.error('Allocation detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Allocations', href: '/dashboard/allocations' }, { label: 'Allocation Detail' }]} />
        <PageHeader title="Allocation Detail" description="Allocation could not be loaded" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Allocation" />
      </div>
    );
  }

  const { allocation, relatedTrip, authority, openDefectCount } = data;
  const stateVariant = ALLOCATION_STATE_VARIANTS[allocation.state] ?? 'info';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Allocations', href: '/dashboard/allocations' },
        { label: `${allocation.make} ${allocation.model}` },
      ]} />
      <PageHeader
        title={`${allocation.make} ${allocation.model}`}
        description={`${allocation.licenceNumber}${allocation.vehicleRegisterNumber ? ` · ${allocation.vehicleRegisterNumber}` : ''} · ${formatDate(allocation.startAt)} – ${formatDate(allocation.endAt)}`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/allocations"><ChevronLeft className="h-4 w-4" /> Back to Allocations</Link>
        </Button>
      </PageHeader>

      {/* Summary Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">
              <Truck className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950">{allocation.make} {allocation.model}</h2>
                <Badge variant={stateVariant} size="sm">{ALLOCATION_STATE_LABELS[allocation.state]}</Badge>
                <Badge variant="info" size="sm">{allocation.licenceNumber}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                {allocation.requestReference && <span className="flex items-center gap-1"><FileText className="h-3.5 w-3.5" />{allocation.requestReference}</span>}
                {allocation.requesterFirstName && <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{allocation.requesterFirstName} {allocation.requesterLastName}</span>}
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Created {formatDate(allocation.createdAt)}</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Detail Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Vehicle Info */}
        <Card>
          <CardHeader><CardTitle>Vehicle Information</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm"><span className="text-ink-500">Status</span><Badge variant={allocation.vehicleStatus === 'available' ? 'success' : allocation.vehicleStatus === 'maintenance' ? 'pending' : 'info'} size="sm">{allocation.vehicleStatus?.replace(/_/g, ' ') ?? 'Unknown'}</Badge></div>
            <div className="flex items-center justify-between text-sm"><span className="text-ink-500">Odometer</span><span className="tabular-nums text-ink-950">{allocation.currentOdometer?.toLocaleString() ?? '—'} km</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-ink-500">Open Defects</span><span className={`tabular-nums ${openDefectCount > 0 ? 'text-status-error-text' : 'text-ink-500'}`}>{openDefectCount}</span></div>
          </CardContent>
        </Card>

        {/* Request Info */}
        <Card>
          <CardHeader><CardTitle>Transport Request</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm"><span className="text-ink-500">Reference</span><span className="text-ink-950">{allocation.requestReference || '—'}</span></div>
            <div className="flex items-center justify-between text-sm"><span className="text-ink-500">Scope</span><Badge variant={allocation.requestScope === 'national' ? 'emergency' : 'info'} size="sm">{allocation.requestScope ?? '—'}</Badge></div>
            <div className="flex items-center justify-between text-sm"><span className="text-ink-500">Requester</span><span className="text-ink-950">{allocation.requesterFirstName ? `${allocation.requesterFirstName} ${allocation.requesterLastName}` : '—'}</span></div>
          </CardContent>
        </Card>

        {/* Allocation Timeline */}
        <Card>
          <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-status-success-bg text-status-success-text"><CheckCircle2 className="h-4 w-4" /></div>
              <div><p className="text-sm font-medium text-ink-950">Allocation Created</p><p className="text-xs text-ink-500">{formatDateTime(allocation.createdAt)}</p></div>
            </div>
            {relatedTrip && (
              <div className="flex items-start gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${relatedTrip.startedAt ? 'bg-status-success-bg text-status-success-text' : 'bg-muted text-ink-400'}`}>
                  <Gauge className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-medium text-ink-950">Trip Started</p>
                  <p className="text-xs text-ink-500">{relatedTrip.startedAt ? formatDateTime(relatedTrip.startedAt) : 'Not yet started'}</p>
                </div>
              </div>
            )}
            {authority && (
              <div className="flex items-start gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-status-info-bg text-status-info-text"><FileText className="h-4 w-4" /></div>
                <div>
                  <p className="text-sm font-medium text-ink-950">Trip Authority Prepared</p>
                  <p className="text-xs text-ink-500">Ref: {authority.releaseReference || 'Pending'}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Allocation Details */}
        <Card>
          <CardHeader><CardTitle>Allocation Details</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm"><span className="text-ink-500">Period</span><span className="text-ink-950">{formatDate(allocation.startAt)} – {formatDate(allocation.endAt)}</span></div>
            {allocation.recommendationScore != null && (
              <div className="flex items-center justify-between text-sm"><span className="text-ink-500">Recommendation Score</span><span className="tabular-nums text-ink-950">{allocation.recommendationScore}/100</span></div>
            )}
            {allocation.overrideReason && (
              <div className="space-y-1"><span className="text-xs text-ink-500 font-medium">Override Reason</span><p className="text-sm text-ink-700 rounded-[8px] bg-muted px-3 py-2">{allocation.overrideReason}</p></div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Defects Warning */}
      {openDefectCount > 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-status-error-text" />
              <span className="text-sm text-ink-700">This vehicle has {openDefectCount} open defect{openDefectCount !== 1 ? 's' : ''}. Review before issuing.</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Related Trip */}
      {relatedTrip && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4 text-ink-500" />
                <span className="text-sm text-ink-700">Related Trip: <span className="font-medium">{relatedTrip.status?.replace(/_/g, ' ')}</span></span>
              </div>
              <Button variant="secondary" size="sm" asChild>
                <Link href={`/dashboard/trips/${relatedTrip.id}`}>View Trip</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
