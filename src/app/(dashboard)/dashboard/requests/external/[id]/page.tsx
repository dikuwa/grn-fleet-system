import Link from 'next/link';
import { and, desc, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, isDbConnected } from '@/db';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { employees } from '@/db/schema/people';
import {
  externalRequestDrivers,
  requestActivities,
  requestPassengers,
  requestRoutes,
  transportRequests,
} from '@/db/schema/requests';
import { workflowActions, workflowInstances, workflowSteps } from '@/db/schema/workflows';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChevronLeft,
  Clock,
  Database,
  FileText,
  MapPin,
  ShieldCheck,
  User,
  Users,
} from 'lucide-react';
import { STATUS_LABELS, STATUS_VARIANTS } from '@/lib/constants';
import { formatDate, formatDateTime } from '@/lib/utils';
import { getServerSession } from '@/lib/session';
import { getSessionPermissions, getSessionRoleNames } from '@/lib/auth-helpers';
import type { PermissionCode } from '@/lib/permissions';
import { canPerformDashboardAction, resolveDashboardAccess } from '@/lib/dashboard-access';
import { CancelRequestButton } from '../../[id]/CancelRequestButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

const ALLOCATABLE_STATUSES = [
  'approved',
  'under_review',
  'transport_review',
  'release_pending',
  'vehicle_allocated',
];

async function fetchExternalRequest(id: string, tenantId: string) {
  const db = getDb();
  const [request] = await db
    .select({
      id: transportRequests.id,
      tenantId: transportRequests.tenantId,
      reference: transportRequests.reference,
      requesterType: transportRequests.requesterType,
      externalRequesterId: transportRequests.externalRequesterId,
      requesterUserId: transportRequests.requesterUserId,
      enteredByUserId: transportRequests.enteredByUserId,
      scope: transportRequests.scope,
      status: transportRequests.status,
      purpose: transportRequests.purpose,
      department: transportRequests.department,
      requestingOfficeSnapshot: transportRequests.requestingOfficeSnapshot,
      urgency: transportRequests.urgency,
      specialRequirements: transportRequests.specialRequirements,
      specialAuthorityRequired: transportRequests.specialAuthorityRequired,
      specialAuthorityReason: transportRequests.specialAuthorityReason,
      totalAuthorisedKilometres: transportRequests.totalAuthorisedKilometres,
      submittedAt: transportRequests.submittedAt,
      createdAt: transportRequests.createdAt,
      requesterFirstName: externalParties.firstName,
      requesterLastName: externalParties.lastName,
      requesterOrganisation: externalParties.organisationName,
      requesterOrganisationType: externalParties.organisationType,
      requesterEmail: externalParties.email,
      requesterPhone: externalParties.phone,
      requesterIdReference: externalParties.idReference,
      responsibleFirstName: employees.firstName,
      responsibleLastName: employees.lastName,
      responsibleEmployeeNumber: employees.employeeNumber,
      responsibleJobTitle: employees.jobTitle,
      responsibleEmail: employees.email,
    })
    .from(transportRequests)
    .leftJoin(externalParties, eq(transportRequests.externalRequesterId, externalParties.id))
    .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, tenantId)))
    .limit(1);

  if (!request || request.requesterType !== 'external' || !request.externalRequesterId) notFound();

  const [activities, passengers, routes, externalDrivers] = await Promise.all([
    db
      .select()
      .from(requestActivities)
      .where(eq(requestActivities.requestId, id))
      .orderBy(requestActivities.startDate),
    db
      .select()
      .from(requestPassengers)
      .where(eq(requestPassengers.requestId, id))
      .orderBy(requestPassengers.createdAt),
    db
      .select()
      .from(requestRoutes)
      .where(eq(requestRoutes.requestId, id))
      .orderBy(requestRoutes.createdAt),
    db
      .select({
        id: externalRequestDrivers.id,
        externalPartyId: externalRequestDrivers.externalPartyId,
        driverType: externalRequestDrivers.driverType,
        isConfirmed: externalRequestDrivers.isConfirmed,
        licenceValidated: externalRequestDrivers.licenceValidated,
        firstName: externalParties.firstName,
        lastName: externalParties.lastName,
        organisationName: externalParties.organisationName,
        licenceNumber: externalDriverLicences.licenceNumber,
        licenceClass: externalDriverLicences.licenceClass,
        expiryDate: externalDriverLicences.expiryDate,
        verificationStatus: externalDriverLicences.verificationStatus,
      })
      .from(externalRequestDrivers)
      .innerJoin(externalParties, eq(externalRequestDrivers.externalPartyId, externalParties.id))
      .leftJoin(
        externalDriverLicences,
        and(
          eq(externalDriverLicences.externalPartyId, externalParties.id),
          eq(externalDriverLicences.verificationStatus, 'verified'),
        ),
      )
      .where(eq(externalRequestDrivers.requestId, id))
      .orderBy(externalRequestDrivers.sortOrder, desc(externalDriverLicences.version)),
  ]);

  const uniqueDrivers = Array.from(
    new Map(externalDrivers.map((driver) => [driver.externalPartyId, driver])).values(),
  );

  return { request, activities, passengers, routes, externalDrivers: uniqueDrivers };
}

export default async function ExternalRequestDetailPage({ params }: PageProps) {
  const { id } = await params;
  const session = await getServerSession();
  if (!session) {
    return (
      <EmptyState
        icon={<Database className="h-6 w-6" />}
        title="Authentication Required"
        description="Please sign in to view this external transport request."
      />
    );
  }
  if (!isDbConnected()) {
    return (
      <EmptyState
        icon={<Database className="h-6 w-6" />}
        title="Database Not Configured"
        description="Set DATABASE_URL and run migrations before opening external requests."
      />
    );
  }

  const data = await fetchExternalRequest(id, session.tenantId);
  const { request, activities, passengers, routes, externalDrivers } = data;
  const roleNames = await getSessionRoleNames(session);
  const access = resolveDashboardAccess('/dashboard/requests', roleNames);
  const isEnteredBy = request.enteredByUserId === session.user.id;

  if (access.recordScope !== 'tenant' && !isEnteredBy) {
    const db = getDb();
    const permissionCodes = await getSessionPermissions(session);
    const [[assignedApproval], [previousApproval]] = await Promise.all([
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
    if (!canReviewApproval && !previousApproval) notFound();
  }

  const requesterName =
    request.requesterFirstName && request.requesterLastName
      ? `${request.requesterFirstName} ${request.requesterLastName}`
      : 'External requester';
  const responsibleName =
    request.responsibleFirstName && request.responsibleLastName
      ? `${request.responsibleFirstName} ${request.responsibleLastName}`
      : 'Responsible internal employee';
  const canModify =
    access.actions.includes('update') && (access.recordScope === 'tenant' || isEnteredBy);
  const canAllocate =
    canPerformDashboardAction('/dashboard/allocations', roleNames, 'create') &&
    ALLOCATABLE_STATUSES.includes(request.status);
  const variant = STATUS_VARIANTS[request.status as keyof typeof STATUS_VARIANTS] ?? 'info';

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Requests', href: '/dashboard/requests' },
          { label: request.reference },
        ]}
      />
      <PageHeader
        title={request.reference}
        description={request.purpose || 'External transport request'}
      >
        {canAllocate && (
          <Button size="sm" asChild>
            <Link href={`/dashboard/allocations/external/new?requestId=${request.id}`}>
              Assign vehicle & external driver
            </Link>
          </Button>
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

      <div className="border-status-info-text/20 bg-status-info-bg text-status-info-text flex flex-wrap items-center gap-2 rounded-[8px] border px-4 py-3 text-sm">
        <Building2 className="h-4 w-4" aria-hidden="true" />
        <strong>External request.</strong>
        <span>The named requester is outside the tenant staff directory. The internal employee below is the routing and operational contact only.</span>
      </div>

      <Card>
        <CardContent className="pt-5">
          <div className="flex flex-wrap items-center gap-2">
            <FileText className="text-brand-700 h-5 w-5" />
            <h2 className="text-ink-950 text-lg font-semibold">{request.reference}</h2>
            <StatusBadge
              status={variant}
              label={STATUS_LABELS[request.status as keyof typeof STATUS_LABELS] ?? request.status}
            />
            <Badge variant="info" size="sm">External</Badge>
            <Badge variant={request.scope === 'national' ? 'emergency' : 'info'} size="sm">
              {request.scope === 'national' ? 'National' : 'Regional'}
            </Badge>
          </div>
          <div className="text-ink-500 mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="flex items-center gap-1"><User className="h-3.5 w-3.5" /> {requesterName}</span>
            {request.requesterOrganisation && <span>{request.requesterOrganisation}</span>}
            <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> Created {formatDate(request.createdAt)}</span>
            {request.submittedAt && <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Submitted {formatDateTime(request.submittedAt)}</span>}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>External requester</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-ink-950 font-semibold">{requesterName}</p>
            <p className="text-ink-600">{request.requesterOrganisation || 'Organisation not recorded'}</p>
            {request.requesterOrganisationType && <p className="text-ink-500 capitalize">{request.requesterOrganisationType.replace(/_/g, ' ')}</p>}
            {request.requesterEmail && <p className="text-ink-500">{request.requesterEmail}</p>}
            {request.requesterPhone && <p className="text-ink-500">{request.requesterPhone}</p>}
            {request.requesterIdReference && <p className="text-ink-500">ID reference: {request.requesterIdReference}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Responsible internal employee</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-ink-950 font-semibold">{responsibleName}</p>
            {request.responsibleEmployeeNumber && <p className="text-ink-500">Employee no. {request.responsibleEmployeeNumber}</p>}
            {request.responsibleJobTitle && <p className="text-ink-500">{request.responsibleJobTitle}</p>}
            {request.department && <p className="text-ink-500">{request.department}</p>}
            {request.requestingOfficeSnapshot && <p className="text-ink-500">{request.requestingOfficeSnapshot}</p>}
            {request.responsibleEmail && <p className="text-ink-500">{request.responsibleEmail}</p>}
            <p className="text-ink-400 pt-1 text-xs">Used for tenant approval routing and operational follow-up; not the requester identity.</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Journey and purpose</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div><p className="text-ink-500 text-xs">Purpose</p><p className="text-ink-950 mt-1 text-sm">{request.purpose || '—'}</p></div>
            <div><p className="text-ink-500 text-xs">Urgency</p><p className="text-ink-950 mt-1 text-sm capitalize">{request.urgency || 'normal'}</p></div>
            <div><p className="text-ink-500 text-xs">Department</p><p className="text-ink-950 mt-1 text-sm">{request.department || '—'}</p></div>
            <div><p className="text-ink-500 text-xs">Authorised distance</p><p className="text-ink-950 mt-1 text-sm tabular-nums">{request.totalAuthorisedKilometres ? `${request.totalAuthorisedKilometres.toLocaleString()} km` : '—'}</p></div>
          </div>
          {request.specialRequirements && <div><p className="text-ink-500 text-xs">Special requirements</p><p className="text-ink-700 mt-1 text-sm">{request.specialRequirements}</p></div>}
          {request.specialAuthorityRequired && <div className="bg-status-pending-bg text-status-pending-text rounded-[8px] px-4 py-3 text-sm">Special authority required{request.specialAuthorityReason ? `: ${request.specialAuthorityReason}` : ''}</div>}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> External driver nomination</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {externalDrivers.length === 0 ? (
              <p className="text-ink-500 text-sm">No external driver nominated. Transport Administration will assign a compliant driver.</p>
            ) : externalDrivers.map((driver) => (
              <div key={driver.id} className="border-border rounded-[8px] border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-ink-950 text-sm font-semibold">{driver.firstName} {driver.lastName}</p>
                  <Badge variant={driver.licenceValidated ? 'success' : 'pending'} size="sm">{driver.licenceValidated ? 'Licence validated' : 'Licence pending'}</Badge>
                </div>
                <p className="text-ink-500 mt-1 text-xs">{driver.organisationName}</p>
                {driver.licenceClass && <p className="text-ink-500 mt-1 text-xs">Class {driver.licenceClass}{driver.expiryDate ? ` · expires ${driver.expiryDate}` : ''}</p>}
                <p className="text-ink-400 mt-2 text-xs">Nomination only — final trip allocation must revalidate eligibility.</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Travellers ({passengers.length})</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {passengers.length === 0 ? <p className="text-ink-500 text-sm">No travellers recorded.</p> : passengers.map((passenger) => (
              <div key={passenger.id} className="border-border flex flex-wrap items-center justify-between gap-2 border-b py-2 last:border-0">
                <div>
                  <p className="text-ink-950 text-sm">{passenger.externalName || 'Traveller'}</p>
                  {passenger.externalOrganisation && <p className="text-ink-500 text-xs">{passenger.externalOrganisation}</p>}
                </div>
                <Badge variant={passenger.status === 'confirmed' ? 'success' : 'pending'} size="sm">{passenger.status}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {activities.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Programme of activities</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {activities.map((activity) => (
              <div key={activity.id} className="border-border border-b pb-3 last:border-0 last:pb-0">
                <p className="text-ink-950 text-sm font-semibold">{activity.title}</p>
                <p className="text-ink-500 mt-1 text-xs">{formatDateTime(activity.startDate)} → {formatDateTime(activity.endDate)}{activity.venue ? ` · ${activity.venue}` : ''}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {routes.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Routes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {routes.map((route) => (
              <div key={route.id} className="border-border rounded-[8px] border p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-ink-950">{route.originName || 'Origin'}</span>
                  <ArrowRight className="text-ink-400 h-3.5 w-3.5" />
                  <span className="text-ink-950">{route.destinationName || 'Destination'}</span>
                </div>
                <p className="text-ink-500 mt-1 text-xs">{route.totalKilometres > 0 ? `${route.totalKilometres.toLocaleString()} km` : 'Distance pending verification'}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
