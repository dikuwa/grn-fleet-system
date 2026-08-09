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
import { programmes } from '@/db/schema/programmes';
import { workflowActions, workflowInstances, workflowSteps } from '@/db/schema/workflows';
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
  ClipboardList,
} from 'lucide-react';
import Link from 'next/link';
import { CancelRequestButton } from './CancelRequestButton';
import { DiscardDraftButton } from './DiscardDraftButton';
import { RouteMapWrapper } from './route-map-wrapper';
import { ResubmitRequestButton } from './ResubmitRequestButton';
import { getSessionPermissions, getSessionRoleNames } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { resolveDashboardAccess } from '@/lib/dashboard-access';

interface PageProps {
  params: Promise<{ id: string }>;
}

const SCOPES = { regional: 'Regional', national: 'National' } as const;

async function fetchRequestDetail(id: string, tenantId: string) {
  const db = getDb();

  const request = await db
    .select({
      id: transportRequests.id,
      requesterUserId: transportRequests.requesterUserId,
      enteredByUserId: transportRequests.enteredByUserId,
      reference: transportRequests.reference,
      scope: transportRequests.scope,
      status: transportRequests.status,
      purpose: transportRequests.purpose,
      department: transportRequests.department,
      programmeId: transportRequests.programmeId,
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

  const [activities, passengers, drivers, routes, attachments, linkedProgramme] =
    await Promise.all([
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
      request.programmeId
        ? db
            .select({
              id: programmes.id,
              reference: programmes.reference,
              title: programmes.title,
              status: programmes.status,
              startDate: programmes.startDate,
              endDate: programmes.endDate,
              venue: programmes.venue,
            })
            .from(programmes)
            .where(
              and(eq(programmes.id, request.programmeId), eq(programmes.tenantId, tenantId)),
            )
            .limit(1)
            .then((r) => r[0] ?? null)
        : Promise.resolve(null),
    ]);

  return { request, activities, passengers, drivers, routes, attachments, linkedProgramme };
}

export default async function RequestDetailPage({ params }: PageProps) {
  const { id } = await params;

  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Requests', href: '/dashboard/requests' },
            { label: 'Request Detail' },
          ]}
        />
        <PageHeader title="Request Detail" description="Authentication required" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Authentication Required"
          description="Please sign in to view request details."
        />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Requests', href: '/dashboard/requests' },
            { label: 'Request Detail' },
          ]}
        />
        <PageHeader title="Request Detail" description="Request could not be loaded" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set DATABASE_URL and run migrations."
        />
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
        <Breadcrumbs
          items={[
            { label: 'Dashboard', href: '/dashboard' },
            { label: 'Requests', href: '/dashboard/requests' },
            { label: 'Request Detail' },
          ]}
        />
        <PageHeader title="Request Detail" description="Request could not be loaded" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Request"
          description="The database query failed. Please run migrations first."
        />
      </div>
    );
  }

  const { request, activities, passengers, drivers, routes, attachments, linkedProgramme } = data;
  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/requests', roleNames);
  const isOwner =
    request.requesterUserId === session.user.id || request.enteredByUserId === session.user.id;

  if (access.recordScope !== 'tenant' && !isOwner) {
    if (request.status === 'draft') notFound();

    const db = getDb();
    const permissionCodes = await getSessionPermissions(session);
    const [[participant], [assignedApproval], [previousApproval]] = await Promise.all([
      db
        .select({ id: requestPassengers.id })
        .from(requestPassengers)
        .innerJoin(employees, eq(requestPassengers.employeeId, employees.id))
        .where(
          and(
            eq(requestPassengers.requestId, id),
            eq(employees.tenantId, session.tenantId),
            eq(employees.userId, session.user.id),
          ),
        )
        .limit(1),
      db
        .select({
          id: workflowInstances.id,
          assignedUserId: workflowSteps.assignedUserId,
          requiredPermission: workflowSteps.requiredPermission,
        })
        .from(workflowInstances)
        .innerJoin(
          workflowSteps,
          and(
            eq(workflowSteps.definitionId, workflowInstances.definitionId),
            eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
          ),
        )
        .where(and(eq(workflowInstances.requestId, id), eq(workflowInstances.status, 'active')))
        .limit(1),
      db
        .select({ id: workflowActions.id })
        .from(workflowActions)
        .innerJoin(workflowInstances, eq(workflowActions.instanceId, workflowInstances.id))
        .where(
          and(
            eq(workflowInstances.requestId, id),
            eq(workflowActions.actorUserId, session.user.id),
          ),
        )
        .limit(1),
    ]);
    const canReviewApproval = Boolean(
      assignedApproval &&
        (assignedApproval.assignedUserId === session.user.id ||
          (assignedApproval.requiredPermission &&
            permissionCodes.includes(assignedApproval.requiredPermission as PermissionCode))),
    );
    if (!participant && !canReviewApproval && !previousApproval) notFound();
  }

  const canModify = access.actions.includes('update') && (access.recordScope === 'tenant' || isOwner);
  const variant = STATUS_VARIANTS[request.status as keyof typeof STATUS_VARIANTS] ?? 'info';
  const requesterName =
    request.requesterFirstName && request.requesterLastName
      ? `${request.requesterFirstName} ${request.requesterLastName}`
      : 'Unknown';

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Requests', href: '/dashboard/requests' },
          { label: request.reference },
        ]}
      />
      <PageHeader title={request.reference} description={request.purpose || 'Transport request'}>
        {canModify &&
          isOwner &&
          ['returned', 'rejected', 'supervisor_rejected'].includes(request.status) && (
            <ResubmitRequestButton requestId={id} />
          )}
        {canModify && request.status === 'draft' && (
          <DiscardDraftButton requestId={id} currentStatus={request.status} />
        )}
        {canModify && request.status !== 'draft' && (
          <CancelRequestButton requestId={id} currentStatus={request.status} />
        )}
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/requests">
            <ChevronLeft className="h-4 w-4" /> Back to Requests
          </Link>
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <div className="bg-brand-50 text-brand-700 flex h-14 w-14 shrink-0 items-center justify-center rounded-[10px]">
              <FileText className="h-7 w-7" />
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-ink-950 text-lg font-semibold">{request.reference}</h2>
                <StatusBadge
                  status={variant}
                  label={STATUS_LABELS[request.status as keyof typeof STATUS_LABELS] ?? request.status}
                />
                <Badge variant={request.scope === 'national' ? 'emergency' : 'info'} size="sm">
                  {SCOPES[request.scope as keyof typeof SCOPES] ?? request.scope}
                </Badge>
              </div>
              <div className="text-ink-500 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5" />
                  {requesterName}
                </span>
                {request.department && <span>{request.department}</span>}
                <span className="flex items-center gap-1">
                  <CalendarDays className="h-3.5 w-3.5" />
                  Created {formatDate(request.createdAt)}
                </span>
                {request.submittedAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Submitted {formatDateTime(request.submittedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <p className="text-ink-500 text-xs font-medium">Requester</p>
              <p className="text-ink-950 mt-0.5 text-sm">{requesterName}</p>
              {request.requesterJobTitle && <p className="text-ink-500 text-xs">{request.requesterJobTitle}</p>}
              {request.requesterEmail && <p className="text-ink-500 text-xs">{request.requesterEmail}</p>}
            </div>
            <div>
              <p className="text-ink-500 text-xs font-medium">Department</p>
              <p className="text-ink-950 mt-0.5 text-sm">{request.department || '—'}</p>
            </div>
            <div>
              <p className="text-ink-500 text-xs font-medium">Purpose</p>
              <p className="text-ink-950 mt-0.5 text-sm">{request.purpose || '—'}</p>
            </div>
            <div>
              <p className="text-ink-500 text-xs font-medium">Authorised Kilometres</p>
              <p className="text-ink-950 mt-0.5 text-sm tabular-nums">
                {request.totalAuthorisedKilometres ? `${request.totalAuthorisedKilometres.toLocaleString()} km` : '—'}
              </p>
            </div>
          </div>

          {request.specialAuthorityRequired && (
            <div className="border-status-pending-bg bg-status-pending-bg mt-4 rounded-[8px] border px-4 py-3">
              <p className="text-status-pending-text text-xs font-medium">Special Authority Required</p>
              <p className="text-ink-700 mt-1 text-sm">{request.specialAuthorityReason || 'No reason provided'}</p>
              {request.specialAuthorityApproved !== null && (
                <p className="mt-1 text-xs">Status: {request.specialAuthorityApproved ? 'Approved' : 'Not Approved'}</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {linkedProgramme && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4" /> Linked Programme
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="border-border flex flex-wrap items-center justify-between gap-3 rounded-[10px] border px-4 py-3">
              <div className="min-w-0">
                <p className="text-ink-950 text-sm font-[650]">{linkedProgramme.title}</p>
                <div className="text-ink-500 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-medium">{linkedProgramme.reference}</span>
                  {linkedProgramme.venue && <span>{linkedProgramme.venue}</span>}
                  {linkedProgramme.startDate && (
                    <span>
                      {formatDate(linkedProgramme.startDate)}
                      {linkedProgramme.endDate && ` → ${formatDate(linkedProgramme.endDate)}`}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="info" size="sm">{linkedProgramme.status.replace(/_/g, ' ')}</Badge>
                <Button variant="secondary" size="sm" asChild>
                  <Link href={`/dashboard/programmes/${linkedProgramme.id}`}>View Programme</Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Programme of Activities ({activities.length})</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {activities.length === 0 ? (
            <div className="px-5 pb-4"><p className="text-ink-500 text-sm">No activities added yet.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border border-b">
                    <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">Title</th>
                    <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">Venue</th>
                    <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">Start</th>
                    <th className="text-ink-500 px-3 py-2 text-left text-xs font-medium">End</th>
                    <th className="text-ink-500 px-3 py-2 text-right text-xs font-medium">Est. Km</th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {activities.map((a) => (
                    <tr key={a.id} className="hover:bg-canvas/50">
                      <td className="text-ink-950 px-3 py-2 font-medium">{a.title}</td>
                      <td className="text-ink-500 px-3 py-2 text-xs">{a.venue || '—'}</td>
                      <td className="text-ink-500 px-3 py-2 text-xs">{formatDate(a.startDate)}</td>
                      <td className="text-ink-500 px-3 py-2 text-xs">{formatDate(a.endDate)}</td>
                      <td className="text-ink-500 px-3 py-2 text-right text-xs tabular-nums">
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

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Passengers ({passengers.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {passengers.length === 0 ? (
              <div className="px-5 pb-4"><p className="text-ink-500 text-sm">No passengers listed.</p></div>
            ) : (
              <div className="divide-border divide-y">
                {passengers.map((p) => {
                  const name = p.empFirstName && p.empLastName ? `${p.empFirstName} ${p.empLastName}` : p.externalName || 'Unknown';
                  return (
                    <div key={p.id} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-brand-50 text-brand-700 flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium">{name.charAt(0)}</div>
                        <div>
                          <p className="text-ink-950 text-sm font-medium">{name}</p>
                          {!p.employeeId && <p className="text-ink-500 text-xs">External</p>}
                        </div>
                      </div>
                      <Badge variant={p.status === 'confirmed' ? 'success' : 'pending'} size="sm">{p.status}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><User className="h-4 w-4" /> Drivers ({drivers.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {drivers.length === 0 ? (
              <div className="px-5 pb-4"><p className="text-ink-500 text-sm">No drivers assigned.</p></div>
            ) : (
              <div className="divide-border divide-y">
                {drivers.map((d) => {
                  const name = d.empFirstName && d.empLastName ? `${d.empFirstName} ${d.empLastName}` : 'Unknown';
                  const driverTypeLabel = d.driverType === 'nominated' ? 'Nominated' : d.driverType === 'assigned' ? 'Assigned' : 'Additional';
                  return (
                    <div key={d.id} className="flex items-center justify-between px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="bg-brand-50 text-brand-700 flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium">{name.charAt(0)}</div>
                        <div>
                          <p className="text-ink-950 text-sm font-medium">{name}</p>
                          <div className="text-ink-500 flex items-center gap-2 text-xs">
                            <Badge variant="info" size="sm">{driverTypeLabel}</Badge>
                            {d.isConfirmed && <span>Confirmed</span>}
                            {d.licenceValidated && <span>Licence Validated</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {d.licenceValidated ? (
                          <span className="text-status-success-text text-xs">✓ Licence OK</span>
                        ) : (
                          <span className="text-status-pending-text text-xs">Licence Pending</span>
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

      {routes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Routes ({routes.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="px-5 pt-4 pb-3">
              <RouteMapWrapper
                routes={routes.map((r) => ({
                  id: r.id,
                  originName: r.originName,
                  destinationName: r.destinationName,
                  originCoordinates: r.originCoordinates as { lat: number; lng: number } | null,
                  destinationCoordinates: r.destinationCoordinates as { lat: number; lng: number } | null,
                  routePolyline: r.routePolyline,
                  mappedDistanceKm: r.mappedDistanceKm,
                  mappedDurationMinutes: r.mappedDurationMinutes,
                  totalKilometres: r.totalKilometres,
                }))}
              />
            </div>
            <div className="divide-border divide-y">
              {routes.map((r) => (
                <div key={r.id} className="px-5 py-4">
                  <div className="flex items-start gap-4">
                    <div className="flex flex-col items-center gap-1">
                      <div className="bg-brand-50 text-brand-700 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium">O</div>
                      <div className="bg-border h-6 w-px" />
                      <div className="bg-ink-50 text-ink-500 flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium">D</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-ink-950 text-sm">{r.originName || 'Unknown origin'}</p>
                      <div className="text-ink-500 flex items-center gap-2 text-xs"><ArrowRight className="h-3 w-3" /></div>
                      <p className="text-ink-950 text-sm">{r.destinationName || 'Unknown destination'}</p>
                      <div className="text-ink-500 mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        {r.mappedDistanceKm != null && <span className="tabular-nums">{r.mappedDistanceKm.toLocaleString()} km (mapped)</span>}
                        {r.additionalKilometres > 0 && <span className="tabular-nums">+{r.additionalKilometres} km additional</span>}
                        {r.totalKilometres > 0 && <span className="text-ink-700 font-medium tabular-nums">Total: {r.totalKilometres.toLocaleString()} km</span>}
                        {r.mappedDurationMinutes != null && <span>~{Math.round(r.mappedDurationMinutes / 60)}h{r.mappedDurationMinutes % 60}m</span>}
                        {r.isVerified && <span className="text-status-success-text">✓ Verified</span>}
                      </div>
                      {r.overrideReason && <p className="text-status-pending-text mt-1 text-xs">Override: {r.overrideReason}</p>}
                      {r.calculationTimestamp && <p className="text-ink-400 mt-0.5 text-[11px]">Calculated {formatDateTime(r.calculationTimestamp)}</p>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {attachments.length > 0 && (
        <Card id="attachments">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Paperclip className="h-4 w-4" /> Attachments ({attachments.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-border divide-y">
              {attachments.map((a) => (
                <div key={a.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="bg-muted text-ink-500 flex h-8 w-8 items-center justify-center rounded-[6px]"><Paperclip className="h-4 w-4" /></div>
                    <div>
                      <p className="text-ink-950 text-sm">{a.fileName}</p>
                      <p className="text-ink-500 text-xs">{a.fileSize ? `${(a.fileSize / 1024).toFixed(1)} KB` : ''} · {a.mimeType}</p>
                    </div>
                  </div>
                  <span className="text-ink-500 text-xs">{formatDate(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
