import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  transportRequests,
  requestActivities,
  requestPassengers,
  requestDrivers,
  requestRoutes,
} from '@/db/schema/requests';
import { employees, departments, driverProfiles } from '@/db/schema/people';
import { notifications } from '@/db/schema/notifications';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { workflowDefinitions } from '@/db/schema/workflows';
import { onRequestSubmitted } from '@/lib/document-generator';
import { WorkflowEngine } from '@/lib/workflow-engine';
import { eq, and, inArray } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/requests/new', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.REQUEST_CREATE);
    if (permCheck instanceof NextResponse) return permCheck;

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
    } = body;
    const clientSubmissionId = req.headers.get('idempotency-key') || bodySubmissionId;

    // Validate required fields
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
      if (existingRequest)
        return NextResponse.json({
          request: existingRequest,
          reference: existingRequest.reference,
          duplicate: true,
        });
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
      return NextResponse.json(
        { error: 'External passenger names are required.' },
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

    // Look up the requester employee — accept employeeNumber from form or resolve from session user
    let requesterEmployee: {
      id: string;
      userId: string | null;
      departmentId: string | null;
      officeId: string | null;
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
        if (createForOther instanceof NextResponse)
          return NextResponse.json(
            { error: 'You may only submit a request for your own linked employee record' },
            { status: 403 },
          );
        if (!assistedReason?.trim())
          return NextResponse.json(
            { error: 'A reason is required when submitting on behalf of an employee' },
            { status: 400 },
          );
      }
    } else {
      // Fall back to finding employee by linked user ID
      const [found] = await db
        .select({
          id: employees.id,
          userId: employees.userId,
          departmentId: employees.departmentId,
          officeId: employees.officeId,
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
        !route.regionId &&
        (!route.officeId || route.officeId === requesterEmployee.officeId) &&
        (!route.departmentId || route.departmentId === requesterEmployee.departmentId),
    );
    if (!hasMatchingRoute) {
      // Notify Tenant Administrators about the missing route configuration
      try {
        await db.insert(notifications).values({
          tenantId,
          recipientUserId: null,
          audience: 'tenant_admin',
          type: 'action_required',
          title: 'Workflow route missing',
          body: `A ${scope} request was blocked because no active route matches the responsible office and department.`,
          entityType: 'system',
          entityId: null,
          actionUrl: '/dashboard/admin/workflows',
          requiredRole: 'Tenant Administrator',
          priority: 'high',
        });
      } catch {
        // Notification is best-effort
      }
      return NextResponse.json(
        {
          error: `No active ${scope} approval route is configured for this office and department. The Tenant Administrator has been notified.`,
        },
        { status: 409 },
      );
    }

    // Generate a reference number
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const seq = String(Math.floor(Math.random() * 900) + 100);
    const reference = `GRN/TR/${now.getFullYear()}/${month}${day}/${seq}`;

    // Calculate total authorised kilometres from routes/activities
    const routeKm = (routes || []).reduce(
      (sum: number, r: { estimatedKm?: number }) => sum + (r.estimatedKm || 0),
      0,
    );
    const activityKm = (activities || []).reduce(
      (sum: number, a: { estimatedKilometres?: number }) => sum + (a.estimatedKilometres || 0),
      0,
    );
    const totalKm = Math.max(routeKm, activityKm);
    const isAssisted = requesterEmployee.userId !== userId;
    const preferredDriverId = preferredDriverEmployeeId || driverEmployeeIds[0] || null;

    // Insert the transport request
    const [request] = await db
      .insert(transportRequests)
      .values({
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
        department: requesterEmployee.departmentName || department || null,
        purpose,
        specialAuthorityRequired: specialAuthorityRequired || false,
        specialAuthorityReason: specialAuthorityReason || null,
        totalAuthorisedKilometres: totalKm || null,
        submittedAt: new Date(),
      })
      .returning();

    // Insert activities
    if (activities?.length > 0) {
      await db.insert(requestActivities).values(
        activities.map(
          (a: {
            title: string;
            description?: string;
            venue?: string;
            startDate: string;
            endDate: string;
            estimatedKilometres?: number;
          }) => ({
            requestId: request.id,
            title: a.title,
            description: a.description || null,
            venue: a.venue || null,
            startDate: new Date(a.startDate),
            endDate: new Date(a.endDate),
            estimatedKilometres: a.estimatedKilometres || null,
          }),
        ),
      );
    }

    // Insert passengers
    if (passengers?.length > 0) {
      await db.insert(requestPassengers).values(
        passengers.map(
          (p: {
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
            requestId: request.id,
            employeeId: p.type === 'employee' && p.employeeId ? p.employeeId : null,
            externalName: p.type === 'external' ? p.externalName || null : null,
            externalIdReference:
              p.type === 'external' ? p.externalIdReference?.trim() || null : null,
            externalOrganisation:
              p.type === 'external' ? p.externalOrganisation?.trim() || null : null,
            externalPhone: p.type === 'external' ? p.externalPhone?.trim() || null : null,
            externalEmail: p.type === 'external' ? p.externalEmail?.trim() || null : null,
            travellerRole: p.travellerRole?.trim() || 'passenger',
            reasonForTravel: p.reasonForTravel?.trim() || purpose,
            status: 'confirmed',
          }),
        ),
      );
    }

    // Insert drivers
    if (drivers?.length > 0) {
      await db.insert(requestDrivers).values(
        drivers.map(
          (d: { employeeId: string; driverType: string; sortOrder: number }, i: number) => ({
            requestId: request.id,
            employeeId: d.employeeId,
            driverType: 'nominated',
            sortOrder: d.sortOrder || i + 1,
          }),
        ),
      );
    }

    // Insert routes
    if (routes?.length > 0) {
      await db.insert(requestRoutes).values(
        routes.map((r: { originName: string; destinationName: string; estimatedKm?: number }) => ({
          requestId: request.id,
          originName: r.originName,
          destinationName: r.destinationName,
          totalKilometres: r.estimatedKm || 0,
          additionalKilometres: 0,
          isVerified: false,
        })),
      );
    }

    // Trigger document generation
    const doc = await onRequestSubmitted(request.id, tenantId, userId);

    // Initialise the workflow engine for this request
    const engine = new WorkflowEngine({ db });
    const wfResult = await engine.initializeForRequest(request.id, tenantId);
    if (wfResult.ok) {
      // Schedule reminders using the correct workflow instance ID
      try {
        const { scheduleStepReminder, scheduleStepEscalation } =
          await import('@/lib/inngest/client');
        await Promise.all([
          scheduleStepReminder(wfResult.instance.id, 1, 2),
          scheduleStepEscalation(wfResult.instance.id, 1, 4),
        ]);
      } catch {
        // Inngest is optional — silently skip if not configured
      }
    } else {
      console.warn('[transport-requests] Workflow initialisation failed:', wfResult.error);
      // Non-blocking — the request is still created
    }

    await recordAuditEvent({
      tenantId,
      actorUserId: userId,
      actorEmployeeId: requesterEmployee.userId === userId ? requesterEmployee.id : null,
      action: isAssisted ? 'request.submitted_on_behalf' : 'request.submitted',
      entityType: 'transport_request',
      entityId: request.id,
      sourceChannel: 'dashboard',
      after: {
        requestingEmployeeId: requesterEmployee.id,
        enteredByUserId: userId,
        submissionMethod: isAssisted ? 'assisted' : 'logged_in',
        preferredDriverEmployeeId: preferredDriverId,
      },
      reason: isAssisted ? assistedReason : undefined,
      summary: isAssisted
        ? `${request.reference} requested for employee ${requesterEmployee.id} and entered by ${userId}`
        : `${request.reference} submitted through logged-in self-service`,
    });
    await recordTenantRequestActivity({
      tenantId,
      requestId: request.id,
      reference: request.reference,
      stage: 'submitted',
      officeLabel: requesterEmployee.departmentName,
    });

    return NextResponse.json({
      request: { ...request, workflowInstanceId: wfResult.ok ? wfResult.instance.id : null },
      document: doc,
      reference: request.reference,
    });
  } catch (error) {
    console.error('[transport-requests] POST failed:', error);
    return NextResponse.json({ error: 'Failed to submit transport request' }, { status: 500 });
  }
}
