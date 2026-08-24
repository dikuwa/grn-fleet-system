import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  departments,
  employees,
  externalParties,
  offices,
  requestActivities,
  requestIntakeLinks,
  requestPassengers,
  requestReferenceSequences,
  requestRoutes,
  tenants,
  transportRequests,
  workflowDefinitions,
} from '@/db/schema';
import { secureHash, publicRequestCsrfAllowed } from '@/lib/secure-request';
import { ensureRequestWorkflow } from '@/lib/request-workflow';
import { generateIdentityAwareTransportRequestDocument } from '@/lib/transport-request-document';
import { recordAuditEvent } from '@/lib/audit-event';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';
import { sendPlainEmail } from '@/lib/email';
import { env } from '@/env';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

async function resolveActiveLink(token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  const db = getDb();
  const [row] = await db
    .select({
      linkId: requestIntakeLinks.id,
      tenantId: requestIntakeLinks.tenantId,
      sponsorEmployeeId: requestIntakeLinks.sponsorEmployeeId,
      label: requestIntakeLinks.label,
      tripScope: requestIntakeLinks.tripScope,
      expiresAt: requestIntakeLinks.expiresAt,
      maxSubmissions: requestIntakeLinks.maxSubmissions,
      submissionCount: requestIntakeLinks.submissionCount,
      createdByUserId: requestIntakeLinks.createdByUserId,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      sponsorFirstName: employees.firstName,
      sponsorLastName: employees.lastName,
      sponsorDepartmentId: employees.departmentId,
      sponsorOfficeId: employees.officeId,
      sponsorRegionId: employees.regionId,
      sponsorDepartmentName: departments.name,
      sponsorOfficeName: offices.name,
    })
    .from(requestIntakeLinks)
    .innerJoin(tenants, eq(tenants.id, requestIntakeLinks.tenantId))
    .innerJoin(
      employees,
      and(
        eq(employees.id, requestIntakeLinks.sponsorEmployeeId),
        eq(employees.tenantId, requestIntakeLinks.tenantId),
      ),
    )
    .leftJoin(departments, eq(departments.id, employees.departmentId))
    .leftJoin(offices, eq(offices.id, employees.officeId))
    .where(
      and(
        eq(requestIntakeLinks.tokenHash, secureHash(token)),
        sql`${requestIntakeLinks.revokedAt} is null`,
        gte(requestIntakeLinks.expiresAt, new Date()),
        sql`${requestIntakeLinks.submissionCount} < ${requestIntakeLinks.maxSubmissions}`,
        eq(employees.employmentStatus, 'active'),
        sql`lower(${tenants.status}) = 'active'`,
      ),
    )
    .limit(1);
  return row || null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const link = await resolveActiveLink(token);
  if (!link) {
    return NextResponse.json(
      { error: 'This external request link is invalid, expired, revoked or has reached its submission limit.' },
      { status: 404, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  return NextResponse.json(
    {
      success: true,
      data: {
        tenantName: link.tenantName,
        label: link.label,
        tripScope: link.tripScope,
        expiresAt: link.expiresAt,
        remainingSubmissions: Math.max(0, link.maxSubmissions - link.submissionCount),
        sponsor: {
          firstName: link.sponsorFirstName,
          lastName: link.sponsorLastName,
          office: link.sponsorOfficeName,
        },
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!publicRequestCsrfAllowed(request)) {
    return NextResponse.json({ error: 'Request could not be submitted' }, { status: 403 });
  }
  const { token } = await params;
  const link = await resolveActiveLink(token);
  if (!link) {
    return NextResponse.json(
      { error: 'This external request link is invalid, expired, revoked or has reached its submission limit.' },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    firstName?: string;
    lastName?: string;
    organisationName?: string;
    organisationType?: string;
    email?: string;
    phone?: string;
    idReference?: string;
    purpose?: string;
    origin?: string;
    destination?: string;
    departureAt?: string;
    returnAt?: string;
    urgency?: string;
    overnight?: boolean;
    specialRequirements?: string;
    requesterTravels?: boolean;
    clientSubmissionId?: string;
  };
  const firstName = String(body.firstName || '').trim();
  const lastName = String(body.lastName || '').trim();
  const organisationName = String(body.organisationName || '').trim();
  const email = String(body.email || '').trim();
  const phone = String(body.phone || '').trim();
  const purpose = String(body.purpose || '').trim();
  const origin = String(body.origin || '').trim();
  const destination = String(body.destination || '').trim();
  const departureAt = new Date(String(body.departureAt || ''));
  const returnAt = new Date(String(body.returnAt || ''));

  if (!firstName || !lastName || !organisationName || !purpose || !origin || !destination) {
    return NextResponse.json(
      { error: 'Name, organisation, purpose, origin and destination are required.' },
      { status: 422 },
    );
  }
  if (!email && !phone) {
    return NextResponse.json({ error: 'Provide an email address or phone number.' }, { status: 422 });
  }
  if (
    firstName.length > 120 ||
    lastName.length > 120 ||
    organisationName.length > 240 ||
    email.length > 240 ||
    phone.length > 80 ||
    purpose.length > 2000 ||
    origin.length > 300 ||
    destination.length > 300
  ) {
    return NextResponse.json({ error: 'One or more request fields are too long.' }, { status: 422 });
  }
  if (
    Number.isNaN(departureAt.getTime()) ||
    Number.isNaN(returnAt.getTime()) ||
    returnAt <= departureAt
  ) {
    return NextResponse.json({ error: 'Return date/time must be after departure.' }, { status: 422 });
  }

  const db = getDb();
  if (body.clientSubmissionId) {
    const [existing] = await db
      .select({ id: transportRequests.id, reference: transportRequests.reference, status: transportRequests.status })
      .from(transportRequests)
      .where(
        and(
          eq(transportRequests.tenantId, link.tenantId),
          eq(transportRequests.clientSubmissionId, String(body.clientSubmissionId).slice(0, 120)),
          eq(transportRequests.requestSource, 'external_public_link'),
        ),
      )
      .limit(1);
    if (existing) return NextResponse.json({ success: true, duplicate: true, request: existing });
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
        eq(workflowDefinitions.tenantId, link.tenantId),
        eq(workflowDefinitions.tripScope, link.tripScope),
        eq(workflowDefinitions.isActive, true),
      ),
    );
  const hasMatchingRoute = routes.some(
    (route) =>
      (!route.regionId || route.regionId === link.sponsorRegionId) &&
      (!route.officeId || route.officeId === link.sponsorOfficeId) &&
      (!route.departmentId || route.departmentId === link.sponsorDepartmentId),
  );
  if (!hasMatchingRoute) {
    return NextResponse.json(
      { error: 'The sponsoring office does not currently have an active approval route. Please contact the organisation.' },
      { status: 409 },
    );
  }

  const now = new Date();
  const sequenceYear = Number(
    new Intl.DateTimeFormat('en', { timeZone: 'Africa/Windhoek', year: 'numeric' }).format(now),
  );
  const [sequence] = await db
    .insert(requestReferenceSequences)
    .values({ tenantId: link.tenantId, sequenceYear, currentValue: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [requestReferenceSequences.tenantId, requestReferenceSequences.sequenceYear],
      set: { currentValue: sql`${requestReferenceSequences.currentValue} + 1`, updatedAt: now },
    })
    .returning({ currentValue: requestReferenceSequences.currentValue });
  if (!sequence?.currentValue) {
    return NextResponse.json({ error: 'A request reference could not be allocated. Please try again.' }, { status: 503 });
  }

  const reference = `GRN/TR/${sequenceYear}/${String(sequence.currentValue).padStart(6, '0')}`;
  const requestId = randomUUID();
  const externalPartyId = randomUUID();
  const trackingToken = randomBytes(32).toString('base64url');
  const publicActor = `public-intake:${link.linkId}`;

  try {
    await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(requestIntakeLinks)
        .set({
          submissionCount: sql`${requestIntakeLinks.submissionCount} + 1`,
          lastSubmittedAt: now,
        })
        .where(
          and(
            eq(requestIntakeLinks.id, link.linkId),
            eq(requestIntakeLinks.tenantId, link.tenantId),
            eq(requestIntakeLinks.tokenHash, secureHash(token)),
            sql`${requestIntakeLinks.revokedAt} is null`,
            gte(requestIntakeLinks.expiresAt, now),
            sql`${requestIntakeLinks.submissionCount} < ${requestIntakeLinks.maxSubmissions}`,
          ),
        )
        .returning({ id: requestIntakeLinks.id });
      if (!claimed) throw new Error('INTAKE_LINK_EXHAUSTED');

      await tx.insert(externalParties).values({
        id: externalPartyId,
        tenantId: link.tenantId,
        firstName,
        lastName,
        organisationName,
        organisationType: String(body.organisationType || 'other').trim().slice(0, 80) || 'other',
        idReference: String(body.idReference || '').trim().slice(0, 120) || null,
        email: email || null,
        phone: phone || null,
        notes: `Created from sponsored public intake link ${link.linkId}`,
        createdByUserId: publicActor,
      });

      await tx.insert(transportRequests).values({
        id: requestId,
        tenantId: link.tenantId,
        reference,
        clientSubmissionId: body.clientSubmissionId ? String(body.clientSubmissionId).slice(0, 120) : null,
        scope: link.tripScope,
        status: 'submitted',
        requesterType: 'external',
        requesterEmployeeId: link.sponsorEmployeeId,
        externalRequesterId: externalPartyId,
        requesterUserId: null,
        enteredByUserId: null,
        requestSource: 'external_public_link',
        requestChannel: 'public_sponsored_link',
        submissionMethod: 'external_secure_link',
        verificationMethod: 'sponsored_bearer_link',
        assistedReason: link.label || `Sponsored external request for ${organisationName}`,
        confirmationMethod: 'external_self_submitted',
        employeeConfirmationStatus: 'not_applicable',
        publicTrackingTokenHash: secureHash(trackingToken),
        driverPreference: 'transport_admin_assign',
        urgency: String(body.urgency || 'normal').trim().slice(0, 40) || 'normal',
        overnight: Boolean(body.overnight),
        specialRequirements: String(body.specialRequirements || '').trim().slice(0, 2000) || null,
        departmentId: link.sponsorDepartmentId,
        officeId: link.sponsorOfficeId,
        regionId: link.sponsorRegionId,
        department: link.sponsorDepartmentName,
        requestingOfficeSnapshot: link.sponsorOfficeName,
        approvalOfficeId: link.sponsorOfficeId,
        purpose,
        submittedAt: now,
      });
      await tx.insert(requestActivities).values({
        requestId,
        title: purpose.slice(0, 160),
        venue: destination,
        startDate: departureAt,
        endDate: returnAt,
      });
      await tx.insert(requestRoutes).values({
        requestId,
        originName: origin,
        destinationName: destination,
        totalKilometres: 0,
        isVerified: false,
      });
      if (body.requesterTravels !== false) {
        await tx.insert(requestPassengers).values({
          requestId,
          externalName: `${firstName} ${lastName}`.trim(),
          externalIdReference: String(body.idReference || '').trim().slice(0, 120) || null,
          externalOrganisation: organisationName,
          externalPhone: phone || null,
          externalEmail: email || null,
          travellerRole: 'external_requester',
          reasonForTravel: purpose,
          status: 'confirmed',
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'INTAKE_LINK_EXHAUSTED') {
      return NextResponse.json(
        { error: 'This external request link is no longer available.' },
        { status: 409 },
      );
    }
    console.error('[public-external-intake] creation failed:', error);
    return NextResponse.json({ error: 'The external request could not be created.' }, { status: 500 });
  }

  let workflow;
  try {
    workflow = await ensureRequestWorkflow(requestId, link.tenantId);
  } catch (workflowError) {
    console.error('[public-external-intake] workflow initialisation failed:', workflowError);
    await db.delete(transportRequests).where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, link.tenantId))).catch(() => undefined);
    await db.delete(externalParties).where(and(eq(externalParties.id, externalPartyId), eq(externalParties.tenantId, link.tenantId))).catch(() => undefined);
    await db.update(requestIntakeLinks)
      .set({ submissionCount: sql`greatest(${requestIntakeLinks.submissionCount} - 1, 0)` })
      .where(and(eq(requestIntakeLinks.id, link.linkId), eq(requestIntakeLinks.tenantId, link.tenantId)))
      .catch(() => undefined);
    return NextResponse.json(
      { error: 'The request could not enter the approval workflow. Nothing was submitted.' },
      { status: 503 },
    );
  }
  if (!workflow.ok) {
    await db.delete(transportRequests).where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, link.tenantId))).catch(() => undefined);
    await db.delete(externalParties).where(and(eq(externalParties.id, externalPartyId), eq(externalParties.tenantId, link.tenantId))).catch(() => undefined);
    await db.update(requestIntakeLinks)
      .set({ submissionCount: sql`greatest(${requestIntakeLinks.submissionCount} - 1, 0)` })
      .where(and(eq(requestIntakeLinks.id, link.linkId), eq(requestIntakeLinks.tenantId, link.tenantId)))
      .catch(() => undefined);
    return workflow.error;
  }

  const document = await generateIdentityAwareTransportRequestDocument({
    requestId,
    tenantId: link.tenantId,
    generatedByUserId: publicActor,
  }).catch((documentError) => {
    console.warn('[public-external-intake] document generation failed:', documentError);
    return null;
  });

  await Promise.allSettled([
    recordAuditEvent({
      tenantId: link.tenantId,
      actorUserId: publicActor,
      action: 'external_request.public_submitted',
      entityType: 'transport_request',
      entityId: requestId,
      sourceChannel: 'public_sponsored_link',
      after: {
        reference,
        intakeLinkId: link.linkId,
        requesterType: 'external',
        externalRequesterId: externalPartyId,
        sponsorEmployeeId: link.sponsorEmployeeId,
        workflowInstanceId: workflow.instance.id,
        documentId: document?.id || null,
      },
      summary: `External transport request ${reference} submitted through sponsored intake link`,
    }),
    recordTenantRequestActivity({
      tenantId: link.tenantId,
      requestId,
      reference,
      stage: 'submitted',
      officeLabel: link.sponsorOfficeName || 'Sponsoring office',
    }),
  ]);

  const trackingUrl = `${env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin}/request/${link.tenantSlug}/track/${requestId}?token=${trackingToken}`;
  if (email) {
    await sendPlainEmail(
      email,
      `Transport request ${reference} received`,
      `Your request to ${link.tenantName} was received.\n\nReference: ${reference}\nTrack it here: ${trackingUrl}`,
    ).catch((emailError) => console.warn('[public-external-intake] receipt email failed:', emailError));
  }

  return NextResponse.json(
    {
      success: true,
      request: { id: requestId, reference, status: 'submitted', workflowInstanceId: workflow.instance.id },
      trackingUrl,
    },
    { status: 201 },
  );
}
