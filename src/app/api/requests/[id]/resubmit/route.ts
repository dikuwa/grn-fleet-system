import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  transportRequests,
  requestActivities,
  requestPassengers,
  requestDrivers,
  requestRoutes,
  requestRevisions,
  programmes,
} from '@/db/schema';
import { departments, driverProfiles, employees, offices } from '@/db/schema/people';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import { abandonRequestWorkflow, ensureRequestWorkflow } from '@/lib/request-workflow';
import { recordAuditEvent } from '@/lib/audit-event';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { validateRequesterDriverNominations } from '@/lib/request-driver-eligibility';
import { programmeEndDateCurrentSql } from '@/lib/programme-availability';
import { onRequestSubmitted } from '@/lib/document-generator';

const EDITABLE_STATUSES = ['returned', 'rejected', 'supervisor_rejected'] as const;

type ActivityInput = {
  title?: string;
  description?: string;
  venue?: string;
  startDate?: string;
  endDate?: string;
  estimatedKilometres?: number;
};

type PassengerInput = {
  type?: 'employee' | 'external';
  employeeId?: string;
  externalName?: string;
  externalIdReference?: string;
  externalOrganisation?: string;
  externalPhone?: string;
  externalEmail?: string;
  travellerRole?: string;
  reasonForTravel?: string;
};

type DriverInput = { employeeId?: string; sortOrder?: number };

type RouteInput = {
  originName?: string;
  destinationName?: string;
  estimatedKm?: number;
  originPlaceId?: string;
  destinationPlaceId?: string;
  originCoordinates?: { lat: number; lng: number } | null;
  destinationCoordinates?: { lat: number; lng: number } | null;
};

type CorrectionBody = {
  reason?: string;
  purpose?: string;
  scope?: 'regional' | 'national';
  programmeId?: string | null;
  specialAuthorityRequired?: boolean;
  specialAuthorityReason?: string;
  driverPreference?: string;
  activities?: ActivityInput[];
  passengers?: PassengerInput[];
  drivers?: DriverInput[];
  routes?: RouteInput[];
};

async function loadEditableRequest(id: string, tenantId: string) {
  const db = getDb();
  const [request] = await db
    .select()
    .from(transportRequests)
    .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, tenantId)))
    .limit(1);
  if (!request) return null;

  const [activities, passengers, drivers, routes] = await Promise.all([
    db.select().from(requestActivities).where(eq(requestActivities.requestId, id)),
    db
      .select({
        id: requestPassengers.id,
        type: sql<'employee' | 'external'>`CASE WHEN ${requestPassengers.employeeId} IS NULL THEN 'external' ELSE 'employee' END`,
        employeeId: requestPassengers.employeeId,
        externalName: requestPassengers.externalName,
        externalIdReference: requestPassengers.externalIdReference,
        externalOrganisation: requestPassengers.externalOrganisation,
        externalPhone: requestPassengers.externalPhone,
        externalEmail: requestPassengers.externalEmail,
        travellerRole: requestPassengers.travellerRole,
        reasonForTravel: requestPassengers.reasonForTravel,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeNumber: employees.employeeNumber,
        email: employees.email,
        jobTitle: employees.jobTitle,
        departmentName: departments.name,
        officeName: offices.name,
        availabilityStatus: employees.availabilityStatus,
      })
      .from(requestPassengers)
      .leftJoin(employees, eq(requestPassengers.employeeId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(offices, eq(employees.officeId, offices.id))
      .where(eq(requestPassengers.requestId, id)),
    db
      .select({
        id: requestDrivers.id,
        employeeId: requestDrivers.employeeId,
        sortOrder: requestDrivers.sortOrder,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeNumber: employees.employeeNumber,
        email: employees.email,
        jobTitle: employees.jobTitle,
        departmentName: departments.name,
        officeName: offices.name,
        driverStatus: driverProfiles.driverStatus,
        availabilityStatus: driverProfiles.availabilityStatus,
      })
      .from(requestDrivers)
      .innerJoin(employees, eq(requestDrivers.employeeId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(offices, eq(employees.officeId, offices.id))
      .leftJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .where(eq(requestDrivers.requestId, id)),
    db.select().from(requestRoutes).where(eq(requestRoutes.requestId, id)),
  ]);

  return { request, activities, passengers, drivers, routes };
}

function canCorrectRequest(
  request: { requesterUserId: string | null; enteredByUserId: string | null },
  userId: string,
) {
  return request.requesterUserId === userId || request.enteredByUserId === userId;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const routeCheck = await requireDashboardAction(session, '/dashboard/requests', 'update');
  if (routeCheck instanceof NextResponse) return routeCheck;
  const permission = await requirePermission(session, Permissions.REQUEST_CREATE);
  if (permission instanceof NextResponse) return permission;

  const data = await loadEditableRequest(id, session.tenantId);
  if (!data || !canCorrectRequest(data.request, session.user.id)) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  if (!EDITABLE_STATUSES.includes(data.request.status as (typeof EDITABLE_STATUSES)[number])) {
    return NextResponse.json(
      { error: `Request cannot be corrected from status ${data.request.status}` },
      { status: 409 },
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      request: data.request,
      activities: data.activities.map((activity) => ({
        ...activity,
        estimatedKm: activity.estimatedKilometres ?? 0,
      })),
      passengers: data.passengers.map((passenger) => ({
        ...passenger,
        employee:
          passenger.employeeId && passenger.firstName && passenger.lastName
            ? {
                id: passenger.employeeId,
                fullName: `${passenger.firstName} ${passenger.lastName}`,
                firstName: passenger.firstName,
                lastName: passenger.lastName,
                employeeNumber: passenger.employeeNumber || '',
                email: passenger.email,
                jobTitle: passenger.jobTitle,
                departmentName: passenger.departmentName,
                officeName: passenger.officeName,
                driverStatus: null,
                availabilityStatus: passenger.availabilityStatus,
              }
            : null,
      })),
      drivers: data.drivers.map((driver) => ({
        id: driver.id,
        employeeId: driver.employeeId,
        sortOrder: driver.sortOrder,
        employee: {
          id: driver.employeeId,
          fullName: `${driver.firstName} ${driver.lastName}`,
          firstName: driver.firstName,
          lastName: driver.lastName,
          employeeNumber: driver.employeeNumber || '',
          email: driver.email,
          jobTitle: driver.jobTitle,
          departmentName: driver.departmentName,
          officeName: driver.officeName,
          driverStatus: driver.driverStatus,
          availabilityStatus: driver.availabilityStatus,
        },
      })),
      routes: data.routes.map((route) => ({
        ...route,
        estimatedKm: route.totalKilometres,
      })),
    },
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const routeCheck = await requireDashboardAction(session, '/dashboard/requests', 'update');
  if (routeCheck instanceof NextResponse) return routeCheck;
  const permission = await requirePermission(session, Permissions.REQUEST_CREATE);
  if (permission instanceof NextResponse) return permission;

  const body = (await request.json().catch(() => ({}))) as CorrectionBody;
  const reason = body.reason?.trim() || '';
  if (reason.length < 3) {
    return NextResponse.json(
      { error: 'Describe the corrections made before resubmitting' },
      { status: 400 },
    );
  }

  const db = getDb();
  const data = await loadEditableRequest(id, session.tenantId);
  if (!data || !canCorrectRequest(data.request, session.user.id)) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }
  const existing = data.request;
  if (!EDITABLE_STATUSES.includes(existing.status as (typeof EDITABLE_STATUSES)[number])) {
    return NextResponse.json(
      { error: `Request cannot be resubmitted from status ${existing.status}` },
      { status: 409 },
    );
  }

  const purpose = body.purpose !== undefined ? body.purpose.trim() : existing.purpose?.trim() || '';
  if (!purpose) return NextResponse.json({ error: 'Purpose is required' }, { status: 400 });
  if (purpose.length > 2000) {
    return NextResponse.json({ error: 'Purpose must be 2,000 characters or fewer' }, { status: 400 });
  }

  const scope = body.scope ?? (existing.scope as 'regional' | 'national');
  if (!['regional', 'national'].includes(scope)) {
    return NextResponse.json({ error: 'Scope must be regional or national' }, { status: 400 });
  }

  const activities = body.activities ?? data.activities.map((activity) => ({
    title: activity.title,
    description: activity.description || undefined,
    venue: activity.venue || undefined,
    startDate: activity.startDate.toISOString(),
    endDate: activity.endDate.toISOString(),
    estimatedKilometres: activity.estimatedKilometres ?? undefined,
  }));
  if (activities.some((activity) => {
    const start = activity.startDate ? new Date(activity.startDate) : null;
    const end = activity.endDate ? new Date(activity.endDate) : null;
    return (
      !activity.title?.trim() ||
      !start || Number.isNaN(start.getTime()) ||
      !end || Number.isNaN(end.getTime()) ||
      end < start ||
      (activity.estimatedKilometres !== undefined &&
        (!Number.isFinite(Number(activity.estimatedKilometres)) || Number(activity.estimatedKilometres) < 0))
    );
  })) {
    return NextResponse.json(
      { error: 'Each activity needs a title and a valid start/end date range.' },
      { status: 400 },
    );
  }

  const passengers = body.passengers ?? data.passengers.map((passenger) => ({
    type: passenger.type,
    employeeId: passenger.employeeId || undefined,
    externalName: passenger.externalName || undefined,
    externalIdReference: passenger.externalIdReference || undefined,
    externalOrganisation: passenger.externalOrganisation || undefined,
    externalPhone: passenger.externalPhone || undefined,
    externalEmail: passenger.externalEmail || undefined,
    travellerRole: passenger.travellerRole,
    reasonForTravel: passenger.reasonForTravel || undefined,
  }));
  const employeePassengers = passengers.filter((passenger) => passenger.type === 'employee');
  const passengerEmployeeIds = Array.from(new Set(employeePassengers.map((passenger) => passenger.employeeId).filter(Boolean))) as string[];
  if (passengerEmployeeIds.length !== employeePassengers.length) {
    return NextResponse.json(
      { error: 'Each employee passenger must be selected once from the employee directory.' },
      { status: 400 },
    );
  }
  if (passengers.some((passenger) => passenger.type === 'external' && !passenger.externalName?.trim())) {
    return NextResponse.json({ error: 'External passenger names are required.' }, { status: 400 });
  }

  const drivers = body.drivers ?? data.drivers.map((driver) => ({
    employeeId: driver.employeeId,
    sortOrder: driver.sortOrder,
  }));
  const driverEmployeeIds = Array.from(new Set(drivers.map((driver) => driver.employeeId).filter(Boolean))) as string[];
  if (driverEmployeeIds.length !== drivers.length) {
    return NextResponse.json(
      { error: 'Each nominated driver must be selected once from the driver directory.' },
      { status: 400 },
    );
  }

  const selectedPersonIds = Array.from(new Set([...passengerEmployeeIds, ...driverEmployeeIds]));
  if (selectedPersonIds.length > 0) {
    const selectedPeople = await db
      .select({
        id: employees.id,
        isDriver: employees.isDriver,
        driverStatus: driverProfiles.driverStatus,
      })
      .from(employees)
      .leftJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .where(and(
        eq(employees.tenantId, session.tenantId),
        eq(employees.employmentStatus, 'active'),
        inArray(employees.id, selectedPersonIds),
      ));
    const byId = new Map(selectedPeople.map((person) => [person.id, person]));
    if (selectedPersonIds.some((personId) => !byId.has(personId))) {
      return NextResponse.json(
        { error: 'One or more selected employees are inactive or outside your organisation.' },
        { status: 400 },
      );
    }
    if (driverEmployeeIds.some((driverId) => {
      const driver = byId.get(driverId);
      return !driver?.isDriver || driver.driverStatus !== 'authorised';
    })) {
      return NextResponse.json(
        { error: 'One or more nominated drivers are not authorised drivers.' },
        { status: 400 },
      );
    }
  }

  if (driverEmployeeIds.length > 0) {
    const tripEndAt = activities.reduce(
      (latest, activity) => {
        const end = activity.endDate ? new Date(activity.endDate) : null;
        return end && end > latest ? end : latest;
      },
      new Date(),
    );
    const eligibility = await validateRequesterDriverNominations({
      tenantId: session.tenantId,
      employeeIds: driverEmployeeIds,
      tripEndAt,
    });
    if (!eligibility.ok) {
      const reasons = Array.from(new Set(eligibility.failures.flatMap((failure) => failure.reasons)));
      return NextResponse.json(
        {
          error: `One or more nominated drivers are not eligible for the requested trip: ${reasons.join('; ')}`,
        },
        { status: 400 },
      );
    }
  }

  const routes = body.routes ?? data.routes.map((route) => ({
    originName: route.originName || undefined,
    destinationName: route.destinationName || undefined,
    estimatedKm: route.totalKilometres,
    originPlaceId: route.originPlaceId || undefined,
    destinationPlaceId: route.destinationPlaceId || undefined,
    originCoordinates: route.originCoordinates as { lat: number; lng: number } | null,
    destinationCoordinates: route.destinationCoordinates as { lat: number; lng: number } | null,
  }));
  if (routes.some((route) =>
    !route.originName?.trim() ||
    !route.destinationName?.trim() ||
    !Number.isFinite(Number(route.estimatedKm ?? 0)) ||
    Number(route.estimatedKm ?? 0) < 0
  )) {
    return NextResponse.json(
      { error: 'Each route needs an origin, destination, and a non-negative distance.' },
      { status: 400 },
    );
  }

  const requestedProgrammeId = body.programmeId === undefined ? existing.programmeId : body.programmeId || null;
  let programmeId: string | null = null;
  if (requestedProgrammeId) {
    const [linkedProgramme] = await db
      .select({ id: programmes.id })
      .from(programmes)
      .where(and(
        eq(programmes.id, requestedProgrammeId),
        eq(programmes.tenantId, session.tenantId),
        sql`${programmes.status} IN ('approved', 'published')`,
        sql`${programmes.archivedAt} IS NULL`,
        programmeEndDateCurrentSql(programmes.endDate),
      ))
      .limit(1);
    if (!linkedProgramme) {
      return NextResponse.json(
        { error: 'The selected programme is no longer available. Choose another programme or remove the link.' },
        { status: 400 },
      );
    }
    programmeId = linkedProgramme.id;
  }

  const specialAuthorityRequired = body.specialAuthorityRequired ?? existing.specialAuthorityRequired;
  const requestOrigin = programmeId
    ? 'programme'
    : existing.requesterType === 'external'
      ? 'external'
      : 'internal';
  const specialAuthorityReason = specialAuthorityRequired
    ? body.specialAuthorityReason !== undefined
      ? body.specialAuthorityReason.trim() || null
      : existing.specialAuthorityReason
    : null;
  if (specialAuthorityRequired && !specialAuthorityReason) {
    return NextResponse.json(
      { error: 'Explain why special authority is required.' },
      { status: 400 },
    );
  }

  const routeKm = routes.reduce((sum, route) => sum + Number(route.estimatedKm || 0), 0);
  const activityKm = activities.reduce(
    (sum, activity) => sum + Number(activity.estimatedKilometres || 0),
    0,
  );
  const totalKm = Math.max(routeKm, activityKm);
  const correctedAt = new Date();
  const correctedAtIso = correctedAt.toISOString();
  const nextVersion = existing.version + 1;
  const nextRevision = existing.revision + 1;

  const changedFields = {
    purpose: purpose !== existing.purpose,
    scope: scope !== existing.scope,
    programmeId: programmeId !== existing.programmeId,
    requestOrigin: requestOrigin !== existing.requestOrigin,
    specialAuthority:
      specialAuthorityRequired !== existing.specialAuthorityRequired ||
      specialAuthorityReason !== existing.specialAuthorityReason,
    activities: true,
    passengers: true,
    drivers: true,
    routes: true,
  };

  const [pendingRevision] = await db
    .select({ id: requestRevisions.id })
    .from(requestRevisions)
    .where(and(eq(requestRevisions.requestId, id), eq(requestRevisions.revision, nextRevision)))
    .limit(1);

  const snapshot = {
    request: {
      scope: existing.scope,
      purpose: existing.purpose,
      programmeId: existing.programmeId,
      requestOrigin: existing.requestOrigin,
      specialAuthorityRequired: existing.specialAuthorityRequired,
      specialAuthorityReason: existing.specialAuthorityReason,
      driverPreference: existing.driverPreference,
      totalAuthorisedKilometres: existing.totalAuthorisedKilometres,
      status: existing.status,
      revision: existing.revision,
      version: existing.version,
    },
    activities: data.activities.map((activity) => ({
      title: activity.title,
      description: activity.description,
      venue: activity.venue,
      startDate: activity.startDate,
      endDate: activity.endDate,
      estimatedKilometres: activity.estimatedKilometres,
    })),
    passengers: data.passengers.map((passenger) => ({
      type: passenger.type,
      employeeId: passenger.employeeId,
      externalName: passenger.externalName,
      externalIdReference: passenger.externalIdReference,
      externalOrganisation: passenger.externalOrganisation,
      externalPhone: passenger.externalPhone,
      externalEmail: passenger.externalEmail,
      travellerRole: passenger.travellerRole,
      reasonForTravel: passenger.reasonForTravel,
    })),
    drivers: data.drivers.map((driver) => ({
      employeeId: driver.employeeId,
      sortOrder: driver.sortOrder,
    })),
    routes: data.routes.map((route) => ({
      originName: route.originName,
      destinationName: route.destinationName,
      originPlaceId: route.originPlaceId,
      destinationPlaceId: route.destinationPlaceId,
      originCoordinates: route.originCoordinates,
      destinationCoordinates: route.destinationCoordinates,
      totalKilometres: route.totalKilometres,
    })),
  };

  try {
    await runAtomicMutations((tx) => {
      const mutations: any[] = [
        tx.execute(sql`
          WITH request_claim AS (
            UPDATE transport_requests
            SET
              purpose = ${purpose},
              scope = ${scope},
              programme_id = ${programmeId}::uuid,
              request_origin = ${requestOrigin},
              special_authority_required = ${specialAuthorityRequired},
              special_authority_reason = ${specialAuthorityReason},
              driver_preference = ${body.driverPreference ?? existing.driverPreference},
              preferred_driver_employee_id = ${driverEmployeeIds[0] || null}::uuid,
              total_authorised_kilometres = ${totalKm || null},
              workflow_instance_id = NULL,
              version = ${nextVersion},
              updated_at = ${correctedAtIso}::timestamptz
            WHERE id = ${id}::uuid
              AND tenant_id = ${session.tenantId}::uuid
              AND status = ${existing.status}
              AND version = ${existing.version}
            RETURNING id
          ),
          workflow_cancelled AS (
            UPDATE workflow_instances wi
            SET status = 'cancelled', updated_at = ${correctedAtIso}::timestamptz
            FROM request_claim rc
            WHERE wi.request_id = rc.id
              AND wi.status = 'active'
            RETURNING wi.id
          )
          SELECT 1 / (SELECT count(*)::integer FROM request_claim) AS committed
        `),
        tx.delete(requestActivities).where(eq(requestActivities.requestId, id)),
        tx.delete(requestPassengers).where(eq(requestPassengers.requestId, id)),
        tx.delete(requestDrivers).where(eq(requestDrivers.requestId, id)),
        tx.delete(requestRoutes).where(eq(requestRoutes.requestId, id)),
      ];

      if (pendingRevision) {
        mutations.push(
          tx.update(requestRevisions)
            .set({ reason, changedFields })
            .where(eq(requestRevisions.id, pendingRevision.id)),
        );
      } else {
        mutations.push(
          tx.insert(requestRevisions).values({
            requestId: id,
            revision: nextRevision,
            reason,
            createdByUserId: session.user.id,
            changedFields,
            data: snapshot,
          }),
        );
      }

      if (activities.length > 0) {
        mutations.push(tx.insert(requestActivities).values(activities.map((activity) => ({
          requestId: id,
          title: activity.title!.trim(),
          description: activity.description?.trim() || null,
          venue: activity.venue?.trim() || null,
          startDate: new Date(activity.startDate!),
          endDate: new Date(activity.endDate!),
          estimatedKilometres: Number(activity.estimatedKilometres || 0) || null,
        }))));
      }
      if (passengers.length > 0) {
        mutations.push(tx.insert(requestPassengers).values(passengers.map((passenger) => ({
          requestId: id,
          employeeId: passenger.type === 'employee' ? passenger.employeeId || null : null,
          externalName: passenger.type === 'external' ? passenger.externalName?.trim() || null : null,
          externalIdReference: passenger.type === 'external' ? passenger.externalIdReference?.trim() || null : null,
          externalOrganisation: passenger.type === 'external' ? passenger.externalOrganisation?.trim() || null : null,
          externalPhone: passenger.type === 'external' ? passenger.externalPhone?.trim() || null : null,
          externalEmail: passenger.type === 'external' ? passenger.externalEmail?.trim() || null : null,
          travellerRole: passenger.travellerRole?.trim() || 'passenger',
          reasonForTravel: passenger.reasonForTravel?.trim() || purpose,
          status: 'confirmed',
        }))));
      }
      if (drivers.length > 0) {
        mutations.push(tx.insert(requestDrivers).values(drivers.map((driver, index) => ({
          requestId: id,
          employeeId: driver.employeeId!,
          driverType: 'nominated',
          sortOrder: driver.sortOrder || index + 1,
        }))));
      }
      if (routes.length > 0) {
        mutations.push(tx.insert(requestRoutes).values(routes.map((route) => ({
          requestId: id,
          originName: route.originName!.trim(),
          destinationName: route.destinationName!.trim(),
          originPlaceId: route.originPlaceId || null,
          destinationPlaceId: route.destinationPlaceId || null,
          originCoordinates: route.originCoordinates || null,
          destinationCoordinates: route.destinationCoordinates || null,
          totalKilometres: Number(route.estimatedKm || 0),
          additionalKilometres: 0,
          isVerified: false,
        }))));
      }
      return mutations;
    });
  } catch (error) {
    const message = String(error);
    if (message.includes('division by zero') || message.includes('stale_request_resubmit')) {
      return NextResponse.json(
        { error: 'This request changed while you were editing it. Refresh and review the latest version before resubmitting.' },
        { status: 409 },
      );
    }
    throw error;
  }

  const corrected = await loadEditableRequest(id, session.tenantId);
  if (!corrected || corrected.request.version !== nextVersion || corrected.request.status !== existing.status) {
    return NextResponse.json(
      { error: 'This request changed while you were editing it. Refresh and review the latest version.' },
      { status: 409 },
    );
  }

  let workflow;
  try {
    workflow = await ensureRequestWorkflow(id, session.tenantId);
  } catch (error) {
    console.error('[request/resubmit] Workflow initialisation failed:', error);
    return NextResponse.json(
      { error: 'Your corrections were saved, but the approval workflow could not be restarted. Try resubmitting again.' },
      { status: 503 },
    );
  }
  if (!workflow.ok) return workflow.error;

  try {
    await db
      .update(transportRequests)
      .set({
        revision: nextRevision,
        status: 'submitted',
        submittedAt: new Date(),
        updatedAt: new Date(),
        version: nextVersion + 1,
      })
      .where(and(
        eq(transportRequests.id, id),
        eq(transportRequests.tenantId, session.tenantId),
        eq(transportRequests.status, existing.status),
        eq(transportRequests.version, nextVersion),
        eq(transportRequests.workflowInstanceId, workflow.instance.id),
      ));

    const [finalised] = await db
      .select({
        status: transportRequests.status,
        revision: transportRequests.revision,
        workflowInstanceId: transportRequests.workflowInstanceId,
      })
      .from(transportRequests)
      .where(and(eq(transportRequests.id, id), eq(transportRequests.tenantId, session.tenantId)))
      .limit(1);
    if (
      !finalised ||
      finalised.status !== 'submitted' ||
      finalised.revision !== nextRevision ||
      finalised.workflowInstanceId !== workflow.instance.id
    ) {
      await abandonRequestWorkflow(id, session.tenantId, workflow.instance.id);
      return NextResponse.json(
        { error: 'This request changed before resubmission completed. Your corrections are saved; refresh before trying again.' },
        { status: 409 },
      );
    }
  } catch (error) {
    await abandonRequestWorkflow(id, session.tenantId, workflow.instance.id).catch(() => undefined);
    throw error;
  }

  try {
    await onRequestSubmitted(id, session.tenantId, session.user.id);
  } catch (documentError) {
    console.warn('[request/resubmit] Corrected Transport Request document refresh failed:', documentError);
  }

  try {
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'request.resubmitted',
      entityType: 'transport_request',
      entityId: id,
      sourceChannel: 'dashboard',
      before: { status: existing.status, revision: existing.revision },
      after: { status: 'submitted', revision: nextRevision, workflowInstanceId: workflow.instance.id },
      reason,
      summary: `${existing.reference} corrected and resubmitted as revision ${nextRevision}`,
    });
  } catch (auditError) {
    console.warn('[request/resubmit] Post-commit audit write failed:', auditError);
  }
  try {
    await recordTenantRequestActivity({
      tenantId: session.tenantId,
      requestId: id,
      reference: existing.reference,
      stage: 'submitted',
      officeLabel: existing.department,
    });
  } catch (activityError) {
    console.warn('[request/resubmit] Post-commit activity write failed:', activityError);
  }

  return NextResponse.json({
    success: true,
    revision: nextRevision,
    workflowInstanceId: workflow.instance.id,
  });
}
