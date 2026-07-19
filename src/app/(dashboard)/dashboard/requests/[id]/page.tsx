import { getDb, isDbConnected } from '@/db';
import {
  transportRequests,
  requestActivities,
  requestPassengers,
  requestDrivers,
  requestRoutes,
  requestAttachments,
} from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, and, desc } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Database } from 'lucide-react';
import { STATUS_LABELS, STATUS_VARIANTS } from '@/lib/constants';
import { formatDate, formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { notFound } from 'next/navigation';
import {
  FileText,
  ChevronLeft,
  MapPin,
  Users,
  User,
  CalendarDays,
  Clock,
  Paperclip,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

interface PageProps {
  params: Promise<{ id: string }>;
}

const SCOPES = { regional: 'Regional', national: 'National' } as const;

async function fetchRequestDetail(id: string, tenantId: string) {
  const db = getDb();

  const request = await db
    .select({
      id: transportRequests.id,
      reference: transportRequests.reference,
      scope: transportRequests.scope,
      status: transportRequests.status,
      purpose: transportRequests.purpose,
      department: transportRequests.department,
      specialAuthorityRequired: transportRequests.specialAuthorityRequired,
      specialAuthorityReason: transportRequests.specialAuthorityReason,
      specialAuthorityApproved: transportRequests.specialAuthorityApproved,
      totalAuthorisedKilometres: transportRequests.totalAuthorisedKilometres,
      submittedAt: transportRequests.submittedAt,
      createdAt: transportRequests.createdAt,
      updatedAt: transportRequests.updatedAt,
      requesterFirstName: employees.firstName,
      requesterLastName: employees.lastName,
      requesterJobTitle: employees.jobTitle,
      requesterEmail: employees.email,
      requesterPhone: employees.phone,
    })
    .from(transportRequests)
    .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, tenantId)))
    .then((r) => r[0] ?? null);

  if (!request) notFound();

  const [activities, passengers, drivers, routes, attachments] = await Promise.all([
    db
      .select()
      .from(requestActivities)
      .where(eq(requestActivities.requestId, id))
      .orderBy(requestActivities.startDate),
    db
      .select({
        id: requestPassengers.id,
        employeeId: requestPassengers.employeeId,
        externalName: requestPassengers.externalName,
        status: requestPassengers.status,
        createdAt: requestPassengers.createdAt,
        empFirstName: employees.firstName,
        empLastName: employees.lastName,
      })
      .from(requestPassengers)
      .leftJoin(employees, eq(requestPassengers.employeeId, employees.id))
      .where(eq(requestPassengers.requestId, id)),
    db
      .select({
        id: requestDrivers.id,
        employeeId: requestDrivers.employeeId,
        driverType: requestDrivers.driverType,
        sortOrder: requestDrivers.sortOrder,
        isConfirmed: requestDrivers.isConfirmed,
        licenceValidated: requestDrivers.licenceValidated,
        createdAt: requestDrivers.createdAt,
        empFirstName: employees.firstName,
        empLastName: employees.lastName,
      })
      .from(requestDrivers)
      .leftJoin(employees, eq(requestDrivers.employeeId, employees.id))
      .where(eq(requestDrivers.requestId, id))
      .orderBy(requestDrivers.sortOrder),
    db
      .select()
      .from(requestRoutes)
      .where(eq(requestRoutes.requestId, id))
      .orderBy(requestRoutes.createdAt),
    db
      .select()
      .from(requestAttachments)
      .where(eq(requestAttachments.requestId, id))
      .orderBy(desc(requestAttachments.createdAt)),
  ]);

  return { request, activities, passengers, drivers, routes, attachments };
}

export default async function RequestDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Requests', href: '/dashboard/requests' }, { label: 'Request Detail' }]} />
        <PageHeader title="Request Detail" description="Authentication required" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" description="Please sign in to view request details." />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Requests', href: '/dashboard/requests' },
          { label: 'Request Detail' },
        ]} />
        <PageHeader title="Request Detail" description="Request could not be loaded" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" description="Set DATABASE_URL and run migrations." />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchRequestDetail>>;
  try {
    data = await fetchRequestDetail(id, session.tenantId);
  } catch (error) {
    console.error('Request detail query failed:', error);
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Requests', href: '/dashboard/requests' },
          { label: 'Request Detail' },
        ]} />
        <PageHeader title="Request Detail" description="Request could not be loaded" />
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Request" description="The database query failed. Please run migrations first." />
      </div>
    );
  }

  const { request, activities, passengers, drivers, routes, attachments } = data;
  const variant = STATUS_VARIANTS[request.status as keyof typeof STATUS_VARIANTS] ?? 'info';
  const requesterName = request.requesterFirstName && request.requesterLastName
    ? `${request.requesterFirstName} ${request.requesterLastName}`
    : 'Unknown';

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Requests', href: '/dashboard/requests' },
        { label: request.reference },
      ]} />
      <PageHeader
        title={request.reference}
        description={request.purpose || 'Transport request'}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/requests">
            <ChevronLeft className="h-4 w-4" /> Back to Requests
          </Link>
        </Button>
      </PageHeader>

      {/* Request Info Card */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700">
              <FileText className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-semibold text-ink-950">{request.reference}</h2>
                <StatusBadge status={variant} label={STATUS_LABELS[request.status as keyof typeof STATUS_LABELS] ?? request.status} />
                <Badge variant={request.scope === 'national' ? 'emergency' : 'info'} size="sm">
                  {SCOPES[request.scope as keyof typeof SCOPES] ?? request.scope}
                </Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" />{requesterName}</span>
                {request.department && <span>{request.department}</span>}
                <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />Created {formatDate(request.createdAt)}</span>
                {request.submittedAt && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />Submitted {formatDateTime(request.submittedAt)}</span>}
              </div>
            </div>
          </div>

          {/* Details Grid */}
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-xs font-medium text-ink-500">Requester</p>
              <p className="mt-0.5 text-sm text-ink-950">{requesterName}</p>
              {request.requesterJobTitle && <p className="text-xs text-ink-500">{request.requesterJobTitle}</p>}
              {request.requesterEmail && <p className="text-xs text-ink-500">{request.requesterEmail}</p>}
            </div>
            <div>
              <p className="text-xs font-medium text-ink-500">Department</p>
              <p className="mt-0.5 text-sm text-ink-950">{request.department || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-500">Purpose</p>
              <p className="mt-0.5 text-sm text-ink-950">{request.purpose || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-ink-500">Authorised Kilometres</p>
              <p className="mt-0.5 text-sm text-ink-950 tabular-nums">
                {request.totalAuthorisedKilometres ? `${request.totalAuthorisedKilometres.toLocaleString()} km` : '—'}
              </p>
            </div>
          </div>

          {request.specialAuthorityRequired && (
            <div className="mt-4 rounded-[8px] border border-status-pending-bg bg-status-pending-bg px-4 py-3">
              <p className="text-xs font-medium text-status-pending-text">Special Authority Required</p>
              <p className="mt-1 text-sm text-ink-700">{request.specialAuthorityReason || 'No reason provided'}</p>
              {request.specialAuthorityApproved !== null && (
                <p className="mt-1 text-xs">
                  Status: {request.specialAuthorityApproved ? 'Approved' : 'Not Approved'}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activities */}
      <Card>
        <CardHeader>
          <CardTitle>Programme of Activities ({activities.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activities.length === 0 ? (
            <div className="px-5 pb-4"><p className="text-sm text-ink-500">No activities added yet.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Title</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Venue</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">Start</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-ink-500">End</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-ink-500">Est. Km</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {activities.map((a) => (
                    <tr key={a.id} className="hover:bg-canvas/50">
                      <td className="px-3 py-2 font-medium text-ink-950">{a.title}</td>
                      <td className="px-3 py-2 text-xs text-ink-500">{a.venue || '—'}</td>
                      <td className="px-3 py-2 text-xs text-ink-500">{formatDate(a.startDate)}</td>
                      <td className="px-3 py-2 text-xs text-ink-500">{formatDate(a.endDate)}</td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-ink-500">
                        {a.estimatedKilometres ? `${a.estimatedKilometres.toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Passengers & Drivers */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" /> Passengers ({passengers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {passengers.length === 0 ? (
              <div className="px-5 pb-4"><p className="text-sm text-ink-500">No passengers listed.</p></div>
            ) : (
              <div className="divide-y divide-border">
                {passengers.map((p) => {
                  const name = p.empFirstName && p.empLastName
                    ? `${p.empFirstName} ${p.empLastName}`
                    : p.externalName || 'Unknown';
                  return (
                    <div key={p.id} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-medium text-brand-700">
                          {name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-ink-950">{name}</p>
                          {!p.employeeId && <p className="text-xs text-ink-500">External</p>}
                        </div>
                      </div>
                      <Badge variant={p.status === 'confirmed' ? 'success' : 'pending'} size="sm">
                        {p.status}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-4 w-4" /> Drivers ({drivers.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {drivers.length === 0 ? (
              <div className="px-5 pb-4"><p className="text-sm text-ink-500">No drivers assigned.</p></div>
            ) : (
              <div className="divide-y divide-border">
                {drivers.map((d) => {
                  const name = d.empFirstName && d.empLastName
                    ? `${d.empFirstName} ${d.empLastName}`
                    : 'Unknown';
                  const driverTypeLabel =
                    d.driverType === 'nominated' ? 'Nominated'
                    : d.driverType === 'assigned' ? 'Assigned'
                    : 'Additional';
                  return (
                    <div key={d.id} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-xs font-medium text-brand-700">
                          {name.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-ink-950">{name}</p>
                          <div className="flex items-center gap-2 text-xs text-ink-500">
                            <Badge variant="info" size="sm">{driverTypeLabel}</Badge>
                            {d.isConfirmed && <span>Confirmed</span>}
                            {d.licenceValidated && <span>Licence Validated</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {d.licenceValidated ? (
                          <span className="text-xs text-status-success-text">✓ Licence OK</span>
                        ) : (
                          <span className="text-xs text-status-pending-text">Licence Pending</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Routes */}
      {routes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-4 w-4" /> Routes ({routes.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {routes.map((r) => (
                <div key={r.id} className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-50 text-xs font-medium text-brand-700">O</div>
                      <div className="h-6 w-px bg-border" />
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-ink-50 text-xs font-medium text-ink-500">D</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink-950">{r.originName || 'Unknown origin'}</p>
                      <div className="flex items-center gap-2 text-xs text-ink-500">
                        <ArrowRight className="h-3 w-3" />
                      </div>
                      <p className="text-sm text-ink-950">{r.destinationName || 'Unknown destination'}</p>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                        {r.mappedDistanceKm != null && (
                          <span className="tabular-nums">{r.mappedDistanceKm.toLocaleString()} km (mapped)</span>
                        )}
                        {r.additionalKilometres > 0 && (
                          <span className="tabular-nums">+{r.additionalKilometres} km additional</span>
                        )}
                        {r.totalKilometres > 0 && (
                          <span className="font-medium text-ink-700 tabular-nums">Total: {r.totalKilometres.toLocaleString()} km</span>
                        )}
                        {r.mappedDurationMinutes != null && (
                          <span>~{Math.round(r.mappedDurationMinutes / 60)}h{r.mappedDurationMinutes % 60}m</span>
                        )}
                        {r.isVerified && <span className="text-status-success-text">✓ Verified</span>}
                      </div>
                      {r.overrideReason && (
                        <p className="mt-1 text-xs text-status-pending-text">Override: {r.overrideReason}</p>
                      )}
                      {r.calculationTimestamp && (
                        <p className="mt-0.5 text-[11px] text-ink-400">Calculated {formatDateTime(r.calculationTimestamp)}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Attachments */}
      {attachments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" /> Attachments ({attachments.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-muted text-ink-500">
                      <Paperclip className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm text-ink-950">{a.fileName}</p>
                      <p className="text-xs text-ink-500">
                        {a.fileSize ? `${(a.fileSize / 1024).toFixed(1)} KB` : ''} · {a.mimeType}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-ink-500">{formatDate(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
