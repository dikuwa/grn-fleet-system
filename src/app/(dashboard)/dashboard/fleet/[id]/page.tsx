import { getDb, isDbConnected } from '@/db';
import { vehicles, vehicleCategories, vehicleDocuments, vehicleDefects, maintenanceEvents, vehicleOdometerEvents } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import { eq, desc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils';
import { notFound } from 'next/navigation';
import {
  Car,
  ChevronLeft,
  Gauge,
  Fuel,
  CheckCircle2,
  XCircle,
  Building2,
  CalendarClock,
  Database,
} from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import Link from 'next/link';
import { TabsShell } from './tabs-shell';

interface PageProps {
  params: Promise<{ id: string }>;
}

const VEHICLE_STATUS_LABELS: Record<string, string> = {
  available: 'Available',
  provisional: 'Provisional',
  allocated: 'Allocated',
  issued: 'Issued',
  maintenance: 'In Maintenance',
  out_of_service: 'Out of Service',
  written_off: 'Written Off',
};

const VEHICLE_STATUS_VARIANTS: Record<
  string,
  'success' | 'pending' | 'info' | 'error' | 'cancelled' | 'emergency'
> = {
  available: 'success',
  provisional: 'pending',
  allocated: 'info',
  issued: 'info',
  maintenance: 'pending',
  out_of_service: 'error',
  written_off: 'cancelled',
};

const SEVERITY_LABELS: Record<string, string> = {
  informational: 'Informational',
  minor: 'Minor',
  major: 'Major',
  critical: 'Critical',
};

async function fetchVehicleDetail(id: string) {
  const db = getDb();
  const vehicle = await db
    .select({
      id: vehicles.id,
      grnNumber: vehicles.grnNumber,
      registrationNumber: vehicles.registrationNumber,
      make: vehicles.make,
      model: vehicles.model,
      year: vehicles.year,
      colour: vehicles.colour,
      fuelType: vehicles.fuelType,
      transmission: vehicles.transmission,
      engineCapacity: vehicles.engineCapacity,
      bodyType: vehicles.bodyType,
      currentOdometer: vehicles.currentOdometer,
      status: vehicles.status,
      fuelCardNumber: vehicles.fuelCardNumber,
      categoryName: vehicleCategories.name,
      officeName: offices.name,
    })
    .from(vehicles)
    .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
    .leftJoin(offices, eq(vehicles.officeId, offices.id))
    .where(eq(vehicles.id, id))
    .then((r) => r[0] ?? null);

  if (!vehicle) {
    notFound();
  }

  const [documents, defects, maintenance, odometerEvents] = await Promise.all([
    db
      .select()
      .from(vehicleDocuments)
      .where(eq(vehicleDocuments.vehicleId, id))
      .orderBy(desc(vehicleDocuments.createdAt)),
    db
      .select()
      .from(vehicleDefects)
      .where(eq(vehicleDefects.vehicleId, id))
      .orderBy(desc(vehicleDefects.createdAt)),
    db
      .select()
      .from(maintenanceEvents)
      .where(eq(maintenanceEvents.vehicleId, id))
      .orderBy(desc(maintenanceEvents.serviceDate)),
    db
      .select()
      .from(vehicleOdometerEvents)
      .where(eq(vehicleOdometerEvents.vehicleId, id))
      .orderBy(desc(vehicleOdometerEvents.createdAt))
      .limit(20),
  ]);

  type DocumentRecord = typeof vehicleDocuments.$inferSelect;
  type DefectRecord = typeof vehicleDefects.$inferSelect;
  type MaintenanceRecord = typeof maintenanceEvents.$inferSelect;
  type OdometerRecord = typeof vehicleOdometerEvents.$inferSelect;

  const openDefects = defects.filter((d: DefectRecord) => !d.resolvedAt);

  return { vehicle, documents: documents as DocumentRecord[], defects: defects as DefectRecord[], maintenance: maintenance as MaintenanceRecord[], odometerEvents: odometerEvents as OdometerRecord[], openDefects };
}

export default async function VehicleDetailPage({ params }: PageProps) {
  const { id } = await params;

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: 'Vehicle Detail' },
        ]} />
        <PageHeader title="Vehicle Detail" description="Vehicle information could not be loaded" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations."
        />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchVehicleDetail>>;
  try {
    data = await fetchVehicleDetail(id);
  } catch (error) {
    console.error('Vehicle detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: 'Vehicle Detail' },
        ]} />
        <PageHeader title="Vehicle Detail" description="Vehicle information could not be loaded" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Vehicle"
          description="The database query failed. Please run migrations and seed first."
        />
      </div>
    );
  }
  const { vehicle } = data;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Fleet', href: '/dashboard/fleet' },
          { label: `${vehicle.make} ${vehicle.model}` },
        ]}
      />
      <PageHeader
        title={`${vehicle.make} ${vehicle.model}`}
        description={`${vehicle.grnNumber}${vehicle.registrationNumber ? ` · ${vehicle.registrationNumber}` : ''}`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/fleet">
            <ChevronLeft className="h-4 w-4" />
            Back to Fleet
          </Link>
        </Button>
      </PageHeader>

      {/* Vehicle Summary Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">
              <Car className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-ink-950">
                  {vehicle.make} {vehicle.model}
                </h2>
                <StatusBadge
                  status={VEHICLE_STATUS_VARIANTS[vehicle.status] ?? 'default'}
                  label={VEHICLE_STATUS_LABELS[vehicle.status] ?? vehicle.status}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="flex items-center gap-1">
                  <Gauge className="h-3.5 w-3.5" />
                  {vehicle.currentOdometer.toLocaleString()} km
                </span>
                <span className="flex items-center gap-1">
                  <Fuel className="h-3.5 w-3.5" />
                  {vehicle.fuelType}
                </span>
                {vehicle.categoryName && <span>{vehicle.categoryName}</span>}
                {vehicle.officeName && (
                  <span className="flex items-center gap-1">
                    <Building2 className="h-3.5 w-3.5" />
                    {vehicle.officeName}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Vehicle Details Grid */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <DetailItem label="GRN Number" value={vehicle.grnNumber} />
            <DetailItem label="Registration" value={vehicle.registrationNumber ?? '—'} />
            <DetailItem label="Year" value={vehicle.year ? String(vehicle.year) : '—'} />
            <DetailItem label="Colour" value={vehicle.colour ?? '—'} />
            <DetailItem label="Transmission" value={vehicle.transmission ?? '—'} />
            <DetailItem label="Engine" value={vehicle.engineCapacity ?? '—'} />
            <DetailItem label="Body Type" value={vehicle.bodyType ?? '—'} />
            <DetailItem label="Fuel Card" value={vehicle.fuelCardNumber ?? '—'} />
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <TabsShell>
        {/* Documents Tab */}
        <Card>
          <CardHeader>
            <CardTitle>Documents ({data.documents.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.documents.length === 0 ? (
              <div className="px-5 pb-4">
                <p className="text-sm text-ink-500">No documents recorded for this vehicle.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Type</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Name</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Reference</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Expiry</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.documents.map((doc) => (
                      <tr key={doc.id} className="hover:bg-canvas/50">
                        <td className="px-3 py-2">
                          <Badge variant="info" size="sm">
                            {doc.documentType.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-ink-700">{doc.documentName}</td>
                        <td className="px-3 py-2 text-xs text-ink-500">
                          {doc.referenceNumber || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs text-ink-500">
                          {doc.expiryDate ? formatDate(doc.expiryDate) : '—'}
                        </td>
                        <td className="px-3 py-2">
                          {doc.isVerified ? (
                            <StatusBadge status="success" label="Verified" />
                          ) : (
                            <StatusBadge status="pending" label="Unverified" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Defects Tab */}
        <Card>
          <CardHeader>
            <CardTitle>Defects ({data.openDefects.length} open)</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.defects.length === 0 ? (
              <div className="px-5 pb-4">
                <p className="text-sm text-ink-500">No defects recorded for this vehicle.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.defects.map((defect) => {
                  const isOpen = !defect.resolvedAt;
                  return (
                    <div
                      key={defect.id}
                      className={`px-5 py-3 ${isOpen && defect.isBlocking ? 'bg-status-error-bg/20' : ''} ${!isOpen ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-ink-950">
                              {defect.description}
                            </p>
                            <StatusBadge
                              status={isOpen ? 'error' : 'success'}
                              label={isOpen ? 'Open' : 'Resolved'}
                            />
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                            <Badge
                              variant={
                                defect.severity === 'critical'
                                  ? 'emergency'
                                  : defect.severity === 'major'
                                    ? 'error'
                                    : defect.severity === 'minor'
                                      ? 'pending'
                                      : 'info'
                              }
                              size="sm"
                            >
                              {SEVERITY_LABELS[defect.severity] || defect.severity}
                            </Badge>
                            <span>Reported {defect.createdAt ? formatDate(defect.createdAt) : ''}</span>
                            {defect.isBlocking && (
                              <span className="font-medium text-status-error-text">Blocking</span>
                            )}
                          </div>
                          {defect.resolutionNotes && (
                            <p className="mt-1 text-xs text-ink-500">
                              Resolution: {defect.resolutionNotes}
                            </p>
                          )}
                        </div>
                        <div className="shrink-0">
                          {isOpen ? (
                            <XCircle className="h-5 w-5 text-status-error-text" />
                          ) : (
                            <CheckCircle2 className="h-5 w-5 text-status-success-text" />
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Maintenance Tab */}
        <Card>
          <CardHeader>
            <CardTitle>Maintenance History ({data.maintenance.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.maintenance.length === 0 ? (
              <div className="px-5 pb-4">
                <p className="text-sm text-ink-500">No maintenance events recorded.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {data.maintenance.map((event) => {
                  return (
                    <div key={event.id} className="px-5 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink-950">
                            {event.description}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                            <span className="flex items-center gap-1">
                              <CalendarClock className="h-3.5 w-3.5" />
                              {event.serviceDate ? formatDate(event.serviceDate) : ''}
                            </span>
                            {event.serviceOdometer != null && (
                              <span className="flex items-center gap-1">
                                <Gauge className="h-3.5 w-3.5" />
                                {Number(event.serviceOdometer).toLocaleString()} km
                              </span>
                            )}
                            <Badge variant="info" size="sm">
                              {event.serviceType.replace(/_/g, ' ')}
                            </Badge>
                          </div>
                          {event.vendorName && (
                            <p className="mt-1 text-xs text-ink-500">
                              Vendor: {event.vendorName}
                            </p>
                          )}
                        </div>
                        {event.nextServiceDate && (
                          <div className="shrink-0 text-right">
                            <p className="text-xs text-ink-500">Next service</p>
                            <p className="text-sm font-medium text-ink-950">
                              {formatDate(event.nextServiceDate)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Odometer History Tab */}
        <Card>
          <CardHeader>
            <CardTitle>Odometer History ({data.odometerEvents.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {data.odometerEvents.length === 0 ? (
              <div className="px-5 pb-4">
                <p className="text-sm text-ink-500">No odometer events recorded.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Date</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-ink-500">Odometer</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Source</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.odometerEvents.map((event) => {
                      return (
                        <tr key={event.id} className="hover:bg-canvas/50">
                          <td className="px-3 py-2 text-xs text-ink-500">
                            {event.createdAt ? formatDate(event.createdAt) : ''}
                          </td>
                          <td className="px-3 py-2 text-right text-sm tabular-nums font-medium text-ink-950">
                            {event.odometerValue.toLocaleString()} km
                          </td>
                          <td className="px-3 py-2">
                            <Badge variant="info" size="sm">
                              {event.source.replace(/_/g, ' ')}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-xs text-ink-500">
                            {event.notes || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </TabsShell>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-ink-500">{label}</p>
      <p className="mt-0.5 text-sm text-ink-950">{value}</p>
    </div>
  );
}
