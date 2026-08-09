import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  transportRequests,
  requestActivities,
  requestPassengers,
  requestDrivers,
  requestRoutes,
} from '@/db/schema/requests';
import { requestReferenceSequences } from '@/db/schema/request-sequences';
import { programmes } from '@/db/schema/programmes';
import { employees, departments, driverProfiles } from '@/db/schema/people';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { workflowDefinitions } from '@/db/schema/workflows';
import { onRequestSubmitted } from '@/lib/document-generator';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import { runAtomicMutations } from '@/lib/db-atomic';
import { ensureRequestWorkflow } from '@/lib/request-workflow';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/requests/new', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const {
      purpose,
      department,
      scope,
      specialAuthorityRequired,
      specialAuthorityReason,
      requesterEmployeeNumber,
      activities,
      passengers,
      drivers,
      routes,
      clientSubmissionId: bodySubmissionId,
      driverPreference,
      preferredDriverEmployeeId,
      assistedReason,
      confirmationMethod,
      travellerEmployeeId,
      urgency,
      overnight,
      specialRequirements,
      vehicleRequirements,
      programmeId,
    } = body;
    const clientSubmissionId = req.headers.get('idempotency-key') || bodySubmissionId;

    if (typeof purpose !== 'string' || !purpose.trim()) {
      return NextResponse.json({ error: 'Purpose is required' }, { status: 400 });
    }
    if (purpose.trim().length > 2000) {
      return NextResponse.json(
        { error: 'Purpose must be 2,000 characters or fewer' },
        { status: 400 },
      );
    }
    if (scope !== 'regional' && scope !== 'national') {
      return NextResponse.json({ error: 'Scope must be regional or national' }, { status: 400 });
    }
    if (specialAuthorityRequired && !String(specialAuthorityReason || '').trim()) {
      return NextResponse.json(
        { error: 'Explain why special authority is required.' },
        { status: 400 },
      );
    }
    if (programmeId != null && typeof programmeId !== 'string') {
      return NextResponse.json({ error: 'Programme must be a valid identifier' }, { status: 400 });
    }
    if (activities !== undefined && !Array.isArray(activities)) {
      return NextResponse.json({ error: 'Activities must be a list' }, { status: 400 });
    }
    if (passengers !== undefined && !Array.isArray(passengers)) {
      return NextResponse.json({ error: 'Passengers must be a list' }, { status: 400 });
    }
    if (drivers !== undefined && !Array.isArray(drivers)) {
      return NextResponse.json({ error: 'Drivers must be a list' }, { status: 400 });
    }
    if (routes !== undefined && !Array.isArray(routes)) {
      return NextResponse.json({ error: 'Routes must be a list' }, { status: 400 });
    }
    if (
      (activities || []).some(
        (activity: {
          title?: string;
          startDate?: string;
          endDate?: string;
          estimatedKilometres?: number;
        }) => {
          const start = activity.startDate ? new Date(activity.startDate) : null;
          const end = activity.endDate ? new Date(activity.endDate) : null;
          return (
            !activity.title?.trim() ||
            !start ||
            Number.isNaN(start.getTime()) ||
            !end ||
            Number.isNaN(end.getTime()) ||
            end < start ||
            (activity.estimatedKilometres !== undefined &&
              (!Number.isFinite(activity.estimatedKilometres) || activity.estimatedKilometres < 0))
          );
        },
      )
    ) {
      return NextResponse.json(
        { error: 'Each activity needs a title and a valid start/end date range.' },
        { status: 400 },
      );
    }
    if (
      (routes || []).some(
        (route: { originName?: string; destinationName?: string; estimatedKm?: number }) =>
          !route.originName?.trim() ||
          !route.destinationName?.trim() ||
          (route.estimatedKm !== undefined &&
            (!Number.isFinite(route.estimatedKm) || route.estimatedKm < 0)),
      )
    ) {
      return NextResponse.json(
        { error: 'Each route needs an origin, destination, and a non-negative distance.' },
        { status: 400 },
      );
    }

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    let resolvedProgrammeId: string | null = null;
    if (programmeId) {
      const [linkedProgramme] = await db
        .select({ id: programmes.id, status: programmes.status })
        .from(programmes)
        .where(
          and(
            eq(programmes.id, programmeId),
            eq(programmes.tenantId, tenantId),
            sql`${programmes.status} IN ('approved', 'published')`,
            sql`${programmes.archivedAt} IS NULL`,
            sql`(${programmes.endDate} IS NULL OR ${programmes.endDate} >= now())`,
          ),
        )
        .limit(1);
      if (!linkedProgramme) {
        return NextResponse.json(
          {
            error:
              'The selected programme is not available. Only approved or published, current, non-archived programmes can be linked to transport requests.',
          },
          { status: 400 },
        );
      }
      resolvedProgrammeId = linkedProgramme.id;
    }

    if (clientSubmissionId) {
      const [existingRequest] = await db
        .select()
        .from(transportRequests)
        .where(
          and(
            eq(transportRequests.tenantId, tenantId),
            eq(transportRequests.clientSubmissionId, clientSubmissionId),
          ),
        )
        .limit(1);
      if (existingRequest) {
        let workflowInstanceId = existingRequest.workflowInstanceId;
        if (existingRequest.status === 'submitted' && !workflowInstanceId) {
          try {
            const workflow = await ensureRequestWorkflow(existingRequest.id, tenantId);
            if (workflow.ok) workflowInstanceId = workflow.instance.id;
          } catch (recoveryError) {
            console.warn('[transport-requests] Idempotent workflow recovery failed:', recoveryError);
          }
        }
        return NextResponse.json({
          request: { ...existingRequest, workflowInstanceId },
          reference: existingRequest.reference,
          duplicate: true,
        });
      }
    }

    const employeePassengers = (passengers || []).filter(
      (passenger: { type?: string }) => passenger.type === 'employee',
    );
    const passengerEmployeeIds = Array.from(
      new Set(
        employeePassengers
          .map((passenger: { employeeId?: string }) => passenger.employeeId)
          .filter(Boolean),
      ),
    ) as string[];
    const driverEmployeeIds = Array.from(
      new Set(
        (drivers || []).map((driver: { employeeId?: string }) => driver.employeeId).filter(Boolean),
      ),
    ) as string[];

    if (passengerEmployeeIds.length !== employeePassengers.length) {
      return NextResponse.json(
        { error: 'Each employee passenger must be selected once from the employee directory.' },
        { status: 400 },
      );
    }
    if (driverEmployeeIds.length !== (drivers || []).length) {
      return NextResponse.json(
        { error: 'Each nominated driver must be selected once from the driver directory.' },
        { status: 400 },
      );
    }
    if (
      (passengers || []).some(
        (passenger: { type?: string; externalName?: string }) =>
          passenger.type === 'external' && !passenger.externalName?.trim(),
      )
    ) {
      return NextResponse.json({ error: 'External passenger names are required.' }, { status: 400 });
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
        .where(
          and(
            eq(employees.tenantId, tenantId),
            eq(employees.employmentStatus, 'active'),
            inArray(employees.id, selectedPersonIds),
          ),
        );
      const selectedPeopleById = new Map(selectedPeople.map((person) => [person.id, person]));
      if (selectedPersonIds.some((id) => !selectedPeopleById.has(id))) {
        return NextResponse.json(
          { error: 'One or more selected employees are inactive or outside your organisation.' },
          { status: 400 },
        );
      }
      if (
        driverEmployeeIds.some((id) => {
          const driver = selectedPeopleById.get(id);
          return !driver?.isDriver || driver.driverStatus !== 'authorised';
        })
      ) {
        return NextResponse.json(
          { error: 'One or more nominated drivers are not authorised drivers.' },
          { status: 400 },
        );
      }
    }

    let requesterEmployee: {
      id: string;
      userId: string | null;
      departmentId: string | null;
      officeId: string | null;
      regionId: string | null;
      departmentName: string | null;
      firstName: string;
    };
    if (requesterEmployeeNumber?.trim()) {
      const [found] = await db
        .select({
          id: employees.id,
          userId: employees.userId,
          departmentId: employees.departmentId,
          officeId: employees.officeId,
          regionId: employees.regionId,
          departmentName: departments.name,
          firstName: employees.firstName,
        })
        .from(employees)
        .leftJoin(departments, eq(employees.departmentId, departments.id))
        .where(
          and(
            eq(employees.employeeNumber, requesterEmployeeNumber),
            eq(employees.tenantId, tenantId),
            eq(employees.employmentStatus, 'active'),
          ),
        )
        .limit(1);
      if (!found) {
        return NextResponse.json(
          { error: 'Requester employee not found in your organisation' },
          { status: 404 },
        );
      }
      requesterEmployee = found;
      if (found.userId !== userId) {
        const createForOther = await requirePermission(session, Permissions.SECURE_REQUEST_ASSIST);
        if (createForOther instanceof NextResponse) {
          return NextResponse.json(
            { error: 'You may only submit a request for your own linked employee record' },
            { status: 403 },
          );
        }
        if (!assistedReason?.trim()) {
          return NextResponse.json(
            { error: 'A reason is required when submitting on behalf of an employee' },
            { status: 400 },
          );
        }
      }
    } else {
      const [found] = await db
        .select({
          id: employees.id,
          userId: employees.userId,
          departmentId: employees.departmentId,
          officeId: employees.officeId,
          regionId: employees.regionId,
          departmentName: departments.name,
          firstName: employees.firstName,
        })
        .from(employees)
        .leftJoin(departments, eq(employees.departmentId, departments.id))
        .where(
          and(
            eq(employees.userId, userId),
            eq(employees.tenantId, tenantId),
            eq(employees.employmentStatus, 'active'),
          ),
        )
        .limit(1);
      if (!found) {
        return NextResponse.json(
          { error: 'Could not identify requester. Log in or provide employee number.' },
          { status: 400 },
        );
      }
      requesterEmployee = found;
    }

    const availableRoutes = await db
      .select({
        id: workflowDefinitions.id,
        regionId: workflowDefinitions.regionId,
        officeId: workflowDefinitions.officeId,
        departmentId: workflowDefinitions.departmentId,
      })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.tenantId, tenantId),
          eq(workflowDefinitions.tripScope, scope),
          eq(workflowDefinitions.isActive, true),
        ),
      );
    const hasMatchingRoute = availableRoutes.some(
      (route) =>
        (!route.regionId || route.regionId === requesterEmployee.regionId) &&
        (!route.officeId || route.officeId === requesterEmployee.officeId) &&
        (!route.departmentId || route.departmentId === requesterEmployee.departmentId),
    );
    if (!hasMatchingRoute) {
      try {
        const recipients = await resolveActiveRoleRecipients(tenantId, [SystemRoles.TENANT_ADMIN]);
        await createScopedNotifications({
          tenantId,
          recipientUserIds: recipients,
          category: 'action_required',
          eventType: 'workflow_route_missing',
          title: 'Workflow route missing',
          body: `A ${scope} request was blocked because no active route matches the responsible region, office and department.`,
          entityType: 'system',
          entityId: null,
          actionUrl: '/dashboard/admin/workflows',
          workspace: WorkspaceIds.TENANT_ADMIN,
          requiredRole: 'Tenant Administrator',
          priority: 'high',
        });
      } catch {
        // Notification is best-effort.
      }
      return NextResponse.json(
        {
          error: `No active ${scope} approval route is configured for this region, office and department. The Tenant Administrator has been notified.`,
        },
        { status: 409 },
      );
    }

    const now = new Date();
    const sequenceYear = Number(
      new Intl.DateTimeFormat('en', { timeZone: 'Africa/Windhoek', year: 'numeric' }).format(now),
    );
    const [sequence] = await db
      .insert(requestReferenceSequences)
      .values({ tenantId, sequenceYear, currentValue: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: [requestReferenceSequences.tenantId, requestReferenceSequences.sequenceYear],
        set: {
          currentValue: sql`${requestReferenceSequences.currentValue} + 1`,
          updatedAt: now,
        },
      })
      .returning({ currentValue: requestReferenceSequences.currentValue });
    if (!sequence?.currentValue) {
      throw new Error('Unable to allocate a transport request reference');
    }
    const reference = `GRN/TR/${sequenceYear}/${String(sequence.currentValue).padStart(6, '0')}`;

    const routeKm = (routes || []).reduce(
      (sum: number, route: { estimatedKm?: number }) => sum + (route.estimatedKm || 0),
      0,
    );
    const activityKm = (activities || []).reduce(
      (sum: number, activity: { estimatedKilometres?: number }) =>
        sum + (activity.estimatedKilometres || 0),
      0,
    );
    const totalKm = Math.max(routeKm, activityKm);
    const isAssisted = requesterEmployee.userId !== userId;
    const preferredDriverId = preferredDriverEmployeeId || driverEmployeeIds[0] || null;
    const requestId = randomUUID();
    const submittedAt = new Date();

    // The request and all dependent itinerary/people rows are one atomic unit.
    // A failed child insert can no longer leave a partially populated submitted request.
    try {
      await runAtomicMutations((tx) => {
        const mutations: any[] = [
          tx.insert(transportRequests).values({
            id: requestId,
            tenantId,
            reference,
            clientSubmissionId: clientSubmissionId || null,
            scope,
            status: 'submitted',
            requesterEmployeeId: requesterEmployee.id,
            requesterUserId: requesterEmployee.userId,
            enteredByUserId: userId,
            requestSource: isAssisted ? 'assisted_by_administration' : 'logged_in_self_service',
            requestChannel: 'dashboard',
            submissionMethod: isAssisted ? 'assisted' : 'logged_in',
            verificationMethod: 'authenticated_session',
            assistedReason: isAssisted ? assistedReason.trim() : null,
            confirmationMethod: isAssisted ? confirmationMethod || null : 'authenticated_submission',
            employeeConfirmationStatus: isAssisted ? 'pending' : 'confirmed',
            preferredDriverEmployeeId: preferredDriverId,
            driverPreference:
              driverPreference || (preferredDriverId ? 'preferred_driver' : 'transport_admin_assign'),
            travellerEmployeeId: travellerEmployeeId || requesterEmployee.id,
            urgency: urgency || 'normal',
            overnight: overnight || false,
            specialRequirements: specialRequirements || null,
            vehicleRequirements: vehicleRequirements || {},
            departmentId: requesterEmployee.departmentId,
            officeId: requesterEmployee.officeId,
            regionId: requesterEmployee.regionId,
            department: requesterEmployee.departmentName || department || null,
            purpose: purpose.trim(),
            programmeId: resolvedProgrammeId,
            specialAuthorityRequired: specialAuthorityRequired || false,
            specialAuthorityReason: specialAuthorityReason?.trim() || null,
            totalAuthorisedKilometres: totalKm || null,
            submittedAt,
          }),
        ];

        if (activities?.length > 0) {
          mutations.push(
            tx.insert(requestActivities).values(
              activities.map(
                (activity: {
                  title: string;
                  description?: string;
                  venue?: string;
                  startDate: string;
                  endDate: string;
                  estimatedKilometres?: number;
                }) => ({
                  requestId,
                  title: activity.title.trim(),
                  description: activity.description?.trim() || null,
                  venue: activity.venue?.trim() || null,
                  startDate: new Date(activity.startDate),
                  endDate: new Date(activity.endDate),
                  estimatedKilometres: activity.estimatedKilometres || null,
                }),
              ),
            ),
          );
        }

        if (passengers?.length > 0) {
          mutations.push(
            tx.insert(requestPassengers).values(
              passengers.map(
                (passenger: {
                  type: string;
                  employeeId?: string;
                  externalName?: string;
                  externalIdReference?: string;
                  externalOrganisation?: string;
                  externalPhone?: string;
                  externalEmail?: string;
                  travellerRole?: string;
                  reasonForTravel?: string;
                }) => ({
                  requestId,
                  employeeId:
                    passenger.type === 'employee' && passenger.employeeId
                      ? passenger.employeeId
                      : null,
                  externalName:
                    passenger.type === 'external' ? passenger.externalName?.trim() || null : null,
                  externalIdReference:
                    passenger.type === 'external'
                      ? passenger.externalIdReference?.trim() || null
                      : null,
                  externalOrganisation:
                    passenger.type === 'external'
                      ? passenger.externalOrganisation?.trim() || null
                      : null,
                  externalPhone:
                    passenger.type === 'external' ? passenger.externalPhone?.trim() || null : null,
                  externalEmail:
                    passenger.type === 'external' ? passenger.externalEmail?.trim() || null : null,
                  travellerRole: passenger.travellerRole?.trim() || 'passenger',
                  reasonForTravel: passenger.reasonForTravel?.trim() || purpose.trim(),
                  status: 'confirmed',
                }),
              ),
            ),
          );
        }

        if (drivers?.length > 0) {
          mutations.push(
            tx.insert(requestDrivers).values(
              drivers.map(
                (driver: { employeeId: string; sortOrder?: number }, index: number) => ({
                  requestId,
                  employeeId: driver.employeeId,
                  driverType: 'nominated',
                  sortOrder: driver.sortOrder || index + 1,
                }),
              ),
            ),
          );
        }

        if (routes?.length > 0) {
          mutations.push(
            tx.insert(requestRoutes).values(
              routes.map(
                (route: {
                  originName: string;
                  destinationName: string;
                  estimatedKm?: number;
                  originPlaceId?: string;
                  destinationPlaceId?: string;
                  originCoordinates?: { lat: number; lng: number };
                  destinationCoordinates?: { lat: number; lng: number };
                }) => ({
                  requestId,
                  originName: route.originName.trim(),
                  destinationName: route.destinationName.trim(),
                  originPlaceId: route.originPlaceId || null,
                  destinationPlaceId: route.destinationPlaceId || null,
                  originCoordinates: route.originCoordinates || null,
                  destinationCoordinates: route.destinationCoordinates || null,
                  totalKilometres: route.estimatedKm || 0,
                  additionalKilometres: 0,
                  isVerified: false,
                }),
              ),
            ),
          );
        }

        return mutations;
      });
    } catch (creationError) {
      // Database uniqueness is the final idempotency guard. If another
      // identical submission committed after the pre-insert lookup, return
      // that durable request instead of surfacing the losing insert as a 500.
      if (clientSubmissionId) {
        const [existingRequest] = await db
          .select()
          .from(transportRequests)
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              eq(transportRequests.clientSubmissionId, clientSubmissionId),
            ),
          )
          .limit(1);
        if (existingRequest) {
          let workflowInstanceId = existingRequest.workflowInstanceId;
          if (existingRequest.status === 'submitted' && !workflowInstanceId) {
            try {
              const recoveredWorkflow = await ensureRequestWorkflow(existingRequest.id, tenantId);
              if (recoveredWorkflow.ok) workflowInstanceId = recoveredWorkflow.instance.id;
            } catch (recoveryError) {
              console.warn('[transport-requests] Concurrent idempotent workflow recovery failed:', recoveryError);
            }
          }
          return NextResponse.json({
            request: { ...existingRequest, workflowInstanceId },
            reference: existingRequest.reference,
            duplicate: true,
          });
        }
      }
      throw creationError;
    }

    // A submitted request without an active workflow is not operationally valid.
    // Initialise/recover the workflow before returning success; if it cannot be
    // started, delete the newly-created request (children/workflow cascade).
    let workflow;
    try {
      workflow = await ensureRequestWorkflow(requestId, tenantId);
    } catch (workflowError) {
      console.error('[transport-requests] Workflow initialisation threw:', workflowError);
      await db
        .delete(transportRequests)
        .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId)))
        .catch(() => undefined);
      return NextResponse.json(
        { error: 'The request could not enter the approval workflow. Nothing was submitted; please try again.' },
        { status: 503 },
      );
    }
    if (!workflow.ok) {
      await db
        .delete(transportRequests)
        .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId)))
        .catch(() => undefined);
      return workflow.error;
    }

    const [request] = await db
      .select()
      .from(transportRequests)
      .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId)))
      .limit(1);
    if (!request) {
      return NextResponse.json(
        { error: 'Request submission could not be verified after workflow creation.' },
        { status: 500 },
      );
    }

    // Documents and awareness/audit side effects happen only after the core
    // request + workflow state is durable. Their failure must never make a
    // successful submission look rolled back to the user.
    let doc: Awaited<ReturnType<typeof onRequestSubmitted>> | null = null;
    try {
      doc = await onRequestSubmitted(requestId, tenantId, userId);
    } catch (documentError) {
      console.warn('[transport-requests] Post-commit document generation failed:', documentError);
    }

    try {
      await recordAuditEvent({
        tenantId,
        actorUserId: userId,
        actorEmployeeId: requesterEmployee.userId === userId ? requesterEmployee.id : null,
        action: isAssisted ? 'request.submitted_on_behalf' : 'request.submitted',
        entityType: 'transport_request',
        entityId: requestId,
        sourceChannel: 'dashboard',
        after: {
          requestingEmployeeId: requesterEmployee.id,
          enteredByUserId: userId,
          submissionMethod: isAssisted ? 'assisted' : 'logged_in',
          preferredDriverEmployeeId: preferredDriverId,
          workflowInstanceId: workflow.instance.id,
        },
        reason: isAssisted ? assistedReason : undefined,
        summary: isAssisted
          ? `${reference} requested for employee ${requesterEmployee.id} and entered by ${userId}`
          : `${reference} submitted through logged-in self-service`,
      });
    } catch (auditError) {
      console.warn('[transport-requests] Post-commit audit write failed:', auditError);
    }

    try {
      await recordTenantRequestActivity({
        tenantId,
        requestId,
        reference,
        stage: 'submitted',
        officeLabel: requesterEmployee.departmentName,
      });
    } catch (activityError) {
      console.warn('[transport-requests] Post-commit request activity failed:', activityError);
    }

    return NextResponse.json({
      request: { ...request, workflowInstanceId: workflow.instance.id },
      document: doc,
      reference,
    });
  } catch (error) {
    console.error('[transport-requests] POST failed:', error);
    return NextResponse.json({ error: 'Failed to submit transport request' }, { status: 500 });
  }
}