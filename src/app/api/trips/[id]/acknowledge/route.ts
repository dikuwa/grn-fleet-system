/**
 * Driver Trip-Authority Acknowledgement API
 * POST /api/trips/[id]/acknowledge
 *
 * This is the one canonical driver-acceptance entry point. It validates the
 * driver's seven explicit confirmations and operational licence, then delegates
 * the durable cross-entity transition to processDriverAcknowledgement().
 */
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleAllocations } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { driverLicences, driverProfiles, employees } from '@/db/schema/people';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { processDriverAcknowledgement } from '@/lib/driver-acknowledgement';
import { sendWorkflowOutcomeEmailBestEffort } from '@/lib/workflow-outcome-email';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      vehicleConfirmed?: boolean;
      authorityConfirmed?: boolean;
      routeUnderstood?: boolean;
      passengersUnderstood?: boolean;
      licenceValidConfirmed?: boolean;
      responsibilityAccepted?: boolean;
      conditionsReviewed?: boolean;
      signature?: string;
      latitude?: number;
      longitude?: number;
      device?: string;
      comment?: string;
    };

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/driver-mobile', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const confirmations = [
      body.vehicleConfirmed,
      body.authorityConfirmed,
      body.routeUnderstood,
      body.passengersUnderstood,
      body.licenceValidConfirmed,
      body.responsibilityAccepted,
      body.conditionsReviewed,
    ];
    if (confirmations.some((confirmed) => confirmed !== true)) {
      return NextResponse.json(
        {
          error:
            'Confirm the vehicle, authority, route, passenger manifest, licence, responsibility and special conditions',
        },
        { status: 422 },
      );
    }
    if (
      body.latitude !== undefined &&
      (!Number.isFinite(body.latitude) || body.latitude < -90 || body.latitude > 90)
    ) {
      return NextResponse.json({ error: 'Latitude is invalid' }, { status: 422 });
    }
    if (
      body.longitude !== undefined &&
      (!Number.isFinite(body.longitude) || body.longitude < -180 || body.longitude > 180)
    ) {
      return NextResponse.json({ error: 'Longitude is invalid' }, { status: 422 });
    }

    const db = getDb();
    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        driverAcknowledgedAt: trips.driverAcknowledgedAt,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestId: transportRequests.id,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        workflowInstanceId: transportRequests.workflowInstanceId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        validUntil: tripAuthorities.validUntil,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(
        and(
          eq(trips.id, id),
          eq(trips.tenantId, session.tenantId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(tripAuthorities.tenantId, session.tenantId),
          eq(vehicleAllocations.state, 'confirmed'),
        ),
      )
      .limit(1);
    if (!trip) return NextResponse.json({ error: 'Current confirmed trip not found' }, { status: 404 });

    const [employee] = await db
      .select({ id: employees.id })
      .from(employees)
      .where(
        and(
          eq(employees.userId, session.user.id),
          eq(employees.tenantId, session.tenantId),
          eq(employees.employmentStatus, 'active'),
        ),
      )
      .limit(1);
    if (!employee || employee.id !== trip.driverEmployeeId) {
      return NextResponse.json({ error: 'Only the primary assigned driver may acknowledge this trip' }, { status: 403 });
    }
    // Once the acknowledgement is durably recorded, retries must stay idempotent
    // even if a later workflow step has already advanced the authority status.
    if (trip.driverAcknowledgedAt) {
      return NextResponse.json({ success: true, alreadyAcknowledged: true });
    }
    if (trip.status !== 'pending') {
      return NextResponse.json(
        { error: `Cannot acknowledge trip with status "${trip.status}". Only pending trips can be acknowledged.` },
        { status: 409 },
      );
    }
    if (
      ![
        'driver_acknowledgement_pending',
        'authorised',
        'approved',
        'approved_emergency',
        'ready_for_issue',
      ].includes(trip.requestStatus)
    ) {
      return NextResponse.json({ error: 'Final authorisation is required before driver acceptance' }, { status: 409 });
    }
    if (trip.authorityStatus !== 'awaiting_driver_acceptance') {
      return NextResponse.json(
        { error: `Trip Authority cannot be accepted from "${trip.authorityStatus}"` },
        { status: 409 },
      );
    }
    if (!trip.workflowInstanceId) {
      return NextResponse.json(
        { error: 'The authorised request has no workflow instance to acknowledge. Ask Transport Administration to review the request.' },
        { status: 409 },
      );
    }

    // Renewal submissions remain provisional. Use only the operationally active,
    // verified licence so a pending newer upload cannot block an otherwise valid trip.
    const [licence] = await db
      .select({
        expiryDate: driverLicences.expiryDate,
        verificationStatus: driverLicences.verificationStatus,
        isActive: driverLicences.isActive,
        driverStatus: driverProfiles.driverStatus,
      })
      .from(driverProfiles)
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(
        and(
          eq(driverProfiles.employeeId, employee.id),
          eq(driverLicences.verificationStatus, 'verified'),
          eq(driverLicences.isActive, true),
        ),
      )
      .orderBy(desc(driverLicences.expiryDate))
      .limit(1);
    const validUntil = trip.validUntil ?? new Date();
    if (
      !licence ||
      licence.driverStatus !== 'authorised' ||
      new Date(`${licence.expiryDate}T23:59:59Z`) < validUntil
    ) {
      return NextResponse.json(
        { error: 'An active verified driver licence valid for the entire trip is required' },
        { status: 409 },
      );
    }

    const result = await processDriverAcknowledgement({
      instanceId: trip.workflowInstanceId,
      result: 'acknowledged',
      comment: body.comment?.trim() || undefined,
      acceptanceData: {
        vehicleConfirmed: true,
        authorityConfirmed: true,
        routeUnderstood: true,
        passengersUnderstood: true,
        licenceValidConfirmed: true,
        responsibilityAccepted: true,
        conditionsReviewed: true,
        signature: body.signature?.trim() || `confirmed:${session.user.id}`,
        latitude: body.latitude ?? null,
        longitude: body.longitude ?? null,
        device: body.device?.trim() || null,
        tripId: trip.id,
        authorityId: trip.authorityId,
      },
      session,
    });
    if (!result.ok) return result.error;

    await sendWorkflowOutcomeEmailBestEffort({
      requestId: trip.requestId,
      result: 'acknowledged',
      stepLabel: 'Driver Acknowledgement',
    });

    const [updatedTrip] = await db
      .select()
      .from(trips)
      .where(and(eq(trips.id, trip.id), eq(trips.tenantId, session.tenantId)))
      .limit(1);

    return NextResponse.json({
      success: true,
      alreadyAcknowledged: false,
      message: result.message,
      trip: updatedTrip,
      workflowInstance: result.instance,
    });
  } catch (error) {
    console.error('[trips/acknowledge] POST failed:', error);
    return NextResponse.json(
      { error: 'Trip acceptance could not be saved. Refresh and try again.' },
      { status: 500 },
    );
  }
}