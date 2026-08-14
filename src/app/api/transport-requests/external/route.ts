import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import {
  externalRequestDrivers,
  requestActivities,
  requestPassengers,
  requestRoutes,
  transportRequests,
} from '@/db/schema/requests';
import { requestReferenceSequences } from '@/db/schema/request-sequences';
import { departments, employees, offices } from '@/db/schema/people';
import { workflowDefinitions } from '@/db/schema/workflows';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { runAtomicMutations } from '@/lib/db-atomic';
import { ensureRequestWorkflow } from '@/lib/request-workflow';
import { recordAuditEvent } from '@/lib/audit-event';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/requests/new', 'create');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permissionCheck = await requirePermission(session, Permissions.SECURE_REQUEST_ASSIST);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const body = (await request.json().catch(() => ({}))) as {
      externalRequesterId?: string;
      responsibleEmployeeId?: string;
      purpose?: string;
      scope?: 'regional' | 'national';
      origin?: string;
      destination?: string;
      departureAt?: string;
      returnAt?: string;
      urgency?: string;
      overnight?: boolean;
      specialRequirements?: string;
      externalDriverId?: string;
      requesterTravels?: boolean;
      clientSubmissionId?: string;
    };
    const externalRequesterId = String(body.externalRequesterId || '').trim();
    const responsibleEmployeeId = String(body.responsibleEmployeeId || '').trim();
    const purpose = String(body.purpose || '').trim();
    const origin = String(body.origin || '').trim();
    const destination = String(body.destination || '').trim();
    const scope = body.scope === 'national' ? 'national' : 'regional';
    const departureAt = new Date(String(body.departureAt || ''));
    const returnAt = new Date(String(body.returnAt || ''));
    if (!externalRequesterId || !responsibleEmployeeId || !purpose || !origin || !destination) {
      return NextResponse.json(
        { error: 'External requester, responsible employee, purpose, origin and destination are required' },
        { status: 422 },
      );
    }
    if (
      Number.isNaN(departureAt.getTime()) ||
      Number.isNaN(returnAt.getTime()) ||
      returnAt <= departureAt
    ) {
      return NextResponse.json({ error: 'Return date/time must be after departure' }, { status: 422 });
    }
    if (purpose.length > 2000 || origin.length > 300 || destination.length > 300) {
      return NextResponse.json({ error: 'Request text is too long' }, { status: 422 });
    }

    const db = getDb();
    const tenantId = session.tenantId;
    if (body.clientSubmissionId) {
      const [existing] = await db
        .select({ id: transportRequests.id, reference: transportRequests.reference, status: transportRequests.status })
        .from(transportRequests)
        .where(
          and(
            eq(transportRequests.tenantId, tenantId),
            eq(transportRequests.clientSubmissionId, body.clientSubmissionId),
          ),
        )
        .limit(1);
      if (existing) return NextResponse.json({ success: true, duplicate: true, request: existing });
    }

    const [[externalRequester], [responsibleEmployee]] = await Promise.all([
      db
        .select()
        .from(externalParties)
        .where(
          and(
            eq(externalParties.id, externalRequesterId),
            eq(externalParties.tenantId, tenantId),
            eq(externalParties.status, 'active'),
          ),
        )
        .limit(1),
      db
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          departmentId: employees.departmentId,
          officeId: employees.officeId,
          regionId: employees.regionId,
          departmentName: departments.name,
          officeName: offices.name,
        })
        .from(employees)
        .leftJoin(departments, eq(departments.id, employees.departmentId))
        .leftJoin(offices, eq(offices.id, employees.officeId))
        .where(
          and(
            eq(employees.id, responsibleEmployeeId),
            eq(employees.tenantId, tenantId),
            eq(employees.employmentStatus, 'active'),
          ),
        )
        .limit(1),
    ]);
    if (!externalRequester) {
      return NextResponse.json({ error: 'External requester is not active in this tenant' }, { status: 404 });
    }
    if (!responsibleEmployee) {
      return NextResponse.json({ error: 'Responsible internal employee is not active in this tenant' }, { status: 404 });
    }

    const routes = await db
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
    const hasRoute = routes.some(
      (route) =>
        (!route.regionId || route.regionId === responsibleEmployee.regionId) &&
        (!route.officeId || route.officeId === responsibleEmployee.officeId) &&
        (!route.departmentId || route.departmentId === responsibleEmployee.departmentId),
    );
    if (!hasRoute) {
      return NextResponse.json(
        { error: 'No active approval route matches the responsible employee’s region, office and department' },
        { status: 409 },
      );
    }

    let externalDriver: typeof externalRequester | null = null;
    if (body.externalDriverId) {
      const [driver] = await db
        .select({ party: externalParties, licence: externalDriverLicences })
        .from(externalParties)
        .innerJoin(
          externalDriverLicences,
          eq(externalDriverLicences.externalPartyId, externalParties.id),
        )
        .where(
          and(
            eq(externalParties.id, body.externalDriverId),
            eq(externalParties.tenantId, tenantId),
            eq(externalParties.status, 'active'),
            eq(externalDriverLicences.tenantId, tenantId),
            eq(externalDriverLicences.verificationStatus, 'verified'),
          ),
        )
        .orderBy(desc(externalDriverLicences.version))
        .limit(1);
      if (!driver || new Date(`${driver.licence.expiryDate}T23:59:59.999Z`) < returnAt) {
        return NextResponse.json(
          { error: 'The nominated external driver must have a verified licence valid through the requested return time' },
          { status: 409 },
        );
      }
      externalDriver = driver.party;
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
        set: { currentValue: sql`${requestReferenceSequences.currentValue} + 1`, updatedAt: now },
      })
      .returning({ currentValue: requestReferenceSequences.currentValue });
    if (!sequence?.currentValue) {
      return NextResponse.json({ error: 'A transport request reference could not be allocated' }, { status: 503 });
    }

    const requestId = randomUUID();
    const reference = `GRN/TR/${sequenceYear}/${String(sequence.currentValue).padStart(6, '0')}`;
    await runAtomicMutations((tx) => {
      const mutations: Array<PromiseLike<unknown>> = [
        tx.insert(transportRequests).values({
          id: requestId,
          tenantId,
          reference,
          clientSubmissionId: body.clientSubmissionId || null,
          scope,
          status: 'submitted',
          requesterType: 'external',
          requesterEmployeeId: responsibleEmployee.id,
          externalRequesterId,
          requesterUserId: null,
          enteredByUserId: session.user.id,
          requestSource: 'assisted_external_party',
          requestChannel: 'dashboard',
          submissionMethod: 'assisted_external',
          verificationMethod: 'staff_verified_external_identity',
          assistedReason: `External transport request for ${externalRequester.organisationName}`,
          confirmationMethod: 'staff_assisted',
          employeeConfirmationStatus: 'not_applicable',
          preferredDriverExternalPartyId: externalDriver?.id || null,
          driverPreference: externalDriver ? 'external_preferred_driver' : 'transport_admin_assign',
          urgency: String(body.urgency || 'normal').slice(0, 40),
          overnight: Boolean(body.overnight),
          specialRequirements: String(body.specialRequirements || '').trim().slice(0, 2000) || null,
          departmentId: responsibleEmployee.departmentId,
          officeId: responsibleEmployee.officeId,
          regionId: responsibleEmployee.regionId,
          department: responsibleEmployee.departmentName,
          requestingOfficeSnapshot: responsibleEmployee.officeName,
          approvalOfficeId: responsibleEmployee.officeId,
          purpose,
          submittedAt: now,
        }),
        tx.insert(requestActivities).values({
          requestId,
          title: purpose.slice(0, 160),
          venue: destination,
          startDate: departureAt,
          endDate: returnAt,
        }),
        tx.insert(requestRoutes).values({
          requestId,
          originName: origin,
          destinationName: destination,
          totalKilometres: 0,
          isVerified: false,
        }),
      ];
      if (body.requesterTravels !== false) {
        mutations.push(
          tx.insert(requestPassengers).values({
            requestId,
            externalName: `${externalRequester.firstName} ${externalRequester.lastName}`.trim(),
            externalIdReference: externalRequester.idReference,
            externalOrganisation: externalRequester.organisationName,
            externalPhone: externalRequester.phone,
            externalEmail: externalRequester.email,
            travellerRole: 'external_requester',
            reasonForTravel: purpose,
            status: 'confirmed',
          }),
        );
      }
      if (externalDriver) {
        mutations.push(
          tx.insert(externalRequestDrivers).values({
            requestId,
            externalPartyId: externalDriver.id,
            driverType: 'nominated',
            sortOrder: 1,
            isConfirmed: false,
            licenceValidated: true,
          }),
        );
      }
      return mutations;
    });

    let workflow;
    try {
      workflow = await ensureRequestWorkflow(requestId, tenantId);
    } catch (workflowError) {
      console.error('[external-request] workflow initialisation failed:', workflowError);
      await db
        .delete(transportRequests)
        .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId)))
        .catch(() => undefined);
      return NextResponse.json(
        { error: 'The external request could not enter the approval workflow. Nothing was submitted.' },
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

    await Promise.allSettled([
      recordAuditEvent({
        tenantId,
        actorUserId: session.user.id,
        action: 'external_request.submitted',
        entityType: 'transport_request',
        entityId: requestId,
        sourceChannel: 'dashboard',
        after: {
          reference,
          requesterType: 'external',
          externalRequesterId,
          responsibleEmployeeId: responsibleEmployee.id,
          externalDriverId: externalDriver?.id || null,
          workflowInstanceId: workflow.instance.id,
        },
        summary: `External transport request ${reference} submitted for ${externalRequester.organisationName}`,
      }),
      recordTenantRequestActivity({
        tenantId,
        requestId,
        reference,
        stage: 'submitted',
        officeLabel: responsibleEmployee.officeName || 'Responsible office',
      }),
    ]);

    return NextResponse.json(
      {
        success: true,
        request: {
          id: requestId,
          reference,
          status: 'submitted',
          workflowInstanceId: workflow.instance.id,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[external-request] POST failed:', error);
    return NextResponse.json({ error: 'External transport request could not be submitted' }, { status: 500 });
  }
}
