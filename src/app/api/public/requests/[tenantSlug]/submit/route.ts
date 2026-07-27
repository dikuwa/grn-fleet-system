import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { getDb } from '@/db';
import {
  employeeCorrectionRequests,
  employees,
  offices,
  requestActivities,
  requestPassengers,
  requestRoutes,
  tenants,
  transportRequests,
  workflowDefinitions,
} from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { publicRequestCsrfAllowed, resolveSecureRequestSession, SECURE_REQUEST_COOKIE, secureHash } from '@/lib/secure-request';
import { WorkflowEngine } from '@/lib/workflow-engine';
import { onRequestSubmitted } from '@/lib/document-generator';
import { sendPlainEmail } from '@/lib/email';
import { env } from '@/env';
import { recordAuditEvent } from '@/lib/audit-event';

function referenceNumber() {
  const now = new Date();
  return `GRN/TR/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}/${randomBytes(3).toString('hex').toUpperCase()}`;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantSlug: string }> }) {
  if (!publicRequestCsrfAllowed(request)) return NextResponse.json({ error: 'Request could not be submitted' }, { status: 403 });
  const { tenantSlug } = await params;
  const secureSession = await resolveSecureRequestSession(request.cookies.get(SECURE_REQUEST_COOKIE)?.value);
  if (!secureSession) return NextResponse.json({ error: 'Your secure request session has expired. Please verify again.' }, { status: 401 });
  const body = await request.json() as {
    purpose?: string;
    scope?: 'regional' | 'national';
    origin?: string;
    destination?: string;
    departureAt?: string;
    returnAt?: string;
    urgency?: string;
    overnight?: boolean;
    specialRequirements?: string;
    driverPreference?: string;
    passengers?: Array<{ externalName: string }>;
    proposedCorrections?: Record<string, string>;
    clientSubmissionId?: string;
  };
  if (!body.purpose?.trim() || !body.origin?.trim() || !body.destination?.trim() || !body.departureAt || !body.returnAt) {
    return NextResponse.json({ error: 'Purpose, origin, destination, departure and return are required.' }, { status: 400 });
  }
  const departureAt = new Date(body.departureAt);
  const returnAt = new Date(body.returnAt);
  if (Number.isNaN(departureAt.getTime()) || Number.isNaN(returnAt.getTime()) || returnAt <= departureAt) {
    return NextResponse.json({ error: 'Return must be after departure.' }, { status: 400 });
  }
  const purpose = body.purpose.trim();
  const origin = body.origin.trim();
  const destination = body.destination.trim();
  const db = getDb();
  const [[tenant], [employee]] = await Promise.all([
    db.select().from(tenants).where(and(eq(tenants.id, secureSession.tenantId), eq(tenants.slug, tenantSlug), eq(tenants.status, 'active'))).limit(1),
    db.select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      email: employees.email,
      departmentId: employees.departmentId,
      officeId: employees.officeId,
      supervisorEmployeeId: employees.supervisorEmployeeId,
      officeName: offices.name,
    }).from(employees)
      .leftJoin(offices, eq(offices.id, employees.officeId))
      .where(and(eq(employees.id, secureSession.employeeId), eq(employees.tenantId, secureSession.tenantId), eq(employees.employmentStatus, 'active'))).limit(1),
  ]);
  if (!tenant || !employee) return NextResponse.json({ error: 'Your secure request session is no longer valid.' }, { status: 401 });
  if (body.clientSubmissionId) {
    const [existing] = await db.select({ id: transportRequests.id, reference: transportRequests.reference })
      .from(transportRequests).where(and(eq(transportRequests.tenantId, tenant.id), eq(transportRequests.clientSubmissionId, body.clientSubmissionId))).limit(1);
    if (existing) return NextResponse.json({ request: existing, duplicate: true });
  }
  const scope = body.scope === 'national' ? 'national' : 'regional';
  const [workflow] = await db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(
    eq(workflowDefinitions.tenantId, tenant.id),
    eq(workflowDefinitions.tripScope, scope),
    eq(workflowDefinitions.isActive, true),
  )).limit(1);
  if (!workflow) return NextResponse.json({ error: 'No approval route is configured. Administration has been notified.' }, { status: 409 });

  const trackingToken = randomBytes(32).toString('base64url');
  const reference = referenceNumber();
  const actorId = `secure-request:${employee.id}`;
  const [created] = await db.transaction(async (tx) => {
    const [record] = await tx.insert(transportRequests).values({
      tenantId: tenant.id,
      reference,
      clientSubmissionId: body.clientSubmissionId || null,
      scope,
      status: 'submitted',
      requesterEmployeeId: employee.id,
      requesterUserId: null,
      enteredByUserId: null,
      requestSource: 'secure_staff_link',
      requestChannel: 'public_tenant_link',
      submissionMethod: 'secure_link',
      verificationMethod: 'email_otp',
      employeeConfirmationStatus: 'verified',
      publicTrackingTokenHash: secureHash(trackingToken),
      departmentId: employee.departmentId,
      officeId: employee.officeId,
      approvalOfficeId: employee.officeId,
      requestingOfficeSnapshot: employee.officeName,
      travellerEmployeeId: employee.id,
      driverPreference: body.driverPreference || 'transport_admin_assign',
      urgency: body.urgency || 'normal',
      overnight: body.overnight || false,
      specialRequirements: body.specialRequirements || null,
      purpose,
      submittedAt: new Date(),
    }).returning();
    await tx.insert(requestActivities).values({
      requestId: record.id,
      title: purpose.slice(0, 160),
      venue: destination,
      startDate: departureAt,
      endDate: returnAt,
    });
    await tx.insert(requestRoutes).values({
      requestId: record.id,
      originName: origin,
      destinationName: destination,
      totalKilometres: 0,
      isVerified: false,
    });
    await tx.insert(requestPassengers).values({
      requestId: record.id,
      employeeId: employee.id,
      status: 'confirmed',
    });
    const external = (body.passengers || []).filter((item) => item.externalName?.trim()).slice(0, 25);
    if (external.length) {
      await tx.insert(requestPassengers).values(external.map((item) => ({
        requestId: record.id,
        externalName: item.externalName.trim(),
        status: 'confirmed',
      })));
    }
    if (body.proposedCorrections && Object.keys(body.proposedCorrections).length) {
      const allowed = Object.fromEntries(
        Object.entries(body.proposedCorrections).filter(([key, value]) =>
          ['phone', 'email', 'office', 'jobTitle'].includes(key) && typeof value === 'string' && value.trim()),
      );
      if (Object.keys(allowed).length) await tx.insert(employeeCorrectionRequests).values({
        tenantId: tenant.id,
        employeeId: employee.id,
        proposedChanges: allowed,
      });
    }
    return [record];
  });
  const workflowEngine = new WorkflowEngine({ db });
  const workflowResult = await workflowEngine.initializeForRequest(created.id, tenant.id);
  await onRequestSubmitted(created.id, tenant.id, actorId);
  await recordAuditEvent({
    tenantId: tenant.id,
    actorUserId: actorId,
    actorEmployeeId: employee.id,
    action: 'request.submitted',
    entityType: 'transport_request',
    entityId: created.id,
    sourceChannel: 'secure_staff_link',
    after: { reference, submissionMethod: 'secure_link', workflowInitialised: workflowResult.ok },
    summary: `${employee.firstName} ${employee.lastName} submitted ${reference} through secure staff link`,
  });
  const trackingUrl = `${env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin}/request/${tenantSlug}/track/${created.id}?token=${trackingToken}`;
  if (employee.email) {
    await sendPlainEmail(employee.email, `Transport request ${reference} received`, `Your request was received.\n\nTrack it here: ${trackingUrl}`);
  }
  return NextResponse.json({ request: { id: created.id, reference, status: created.status }, trackingUrl }, { status: 201 });
}
