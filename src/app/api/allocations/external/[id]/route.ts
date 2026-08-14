import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { tripAuthorities, tripIssues, trips, vehicleAllocations } from '@/db/schema/trips';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const actionCheck = await requireDashboardAction(session, '/dashboard/allocations', 'view');
    if (actionCheck instanceof NextResponse) return actionCheck;
    const permissionCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { id } = await context.params;
    const db = getDb();
    const tenantId = session.tenantId;
    const [record] = await db
      .select({
        assignment: externalDriverAssignments,
        requestReference: transportRequests.reference,
        requestPurpose: transportRequests.purpose,
        requestStatus: transportRequests.status,
        vehicleLicenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        vehicleCurrentOdometer: vehicles.currentOdometer,
        allocationStartAt: vehicleAllocations.startAt,
        allocationEndAt: vehicleAllocations.endAt,
        allocationState: vehicleAllocations.state,
        tripStatus: trips.status,
        tripIssuedAt: trips.issuedAt,
        authorityStatus: tripAuthorities.status,
        issueOdometer: tripIssues.issueOdometer,
        driverFirstName: externalParties.firstName,
        driverLastName: externalParties.lastName,
        driverOrganisation: externalParties.organisationName,
        driverPhone: externalParties.phone,
        driverEmail: externalParties.email,
        licenceNumber: externalDriverLicences.licenceNumber,
        licenceClass: externalDriverLicences.licenceClass,
        licenceExpiry: externalDriverLicences.expiryDate,
        licenceStatus: externalDriverLicences.verificationStatus,
      })
      .from(externalDriverAssignments)
      .innerJoin(transportRequests, eq(transportRequests.id, externalDriverAssignments.requestId))
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, externalDriverAssignments.allocationId))
      .innerJoin(trips, eq(trips.id, externalDriverAssignments.tripId))
      .innerJoin(vehicles, eq(vehicles.id, vehicleAllocations.vehicleId))
      .leftJoin(
        tripAuthorities,
        and(eq(tripAuthorities.tripId, trips.id), eq(tripAuthorities.tenantId, tenantId)),
      )
      .leftJoin(tripIssues, eq(tripIssues.id, externalDriverAssignments.issueId))
      .innerJoin(externalParties, eq(externalParties.id, externalDriverAssignments.externalPartyId))
      .innerJoin(externalDriverLicences, eq(externalDriverLicences.id, externalDriverAssignments.licenceId))
      .where(
        and(
          eq(externalDriverAssignments.id, id),
          eq(externalDriverAssignments.tenantId, tenantId),
          eq(transportRequests.tenantId, tenantId),
          eq(trips.tenantId, tenantId),
          eq(vehicles.tenantId, tenantId),
          eq(externalParties.tenantId, tenantId),
          eq(externalDriverLicences.tenantId, tenantId),
        ),
      )
      .limit(1);
    if (!record) return NextResponse.json({ error: 'External driver assignment not found' }, { status: 404 });

    return NextResponse.json({
      success: true,
      data: {
        id: record.assignment.id,
        state: record.assignment.state,
        driverType: record.assignment.driverType,
        assignedAt: record.assignment.assignedAt,
        acceptedAt: record.assignment.acceptedAt,
        acceptanceMethod: record.assignment.acceptanceMethod,
        acceptanceNote: record.assignment.acceptanceNote,
        cancelledAt: record.assignment.cancelledAt,
        cancellationReason: record.assignment.cancellationReason,
        allocationId: record.assignment.allocationId,
        tripId: record.assignment.tripId,
        issueId: record.assignment.issueId,
        issueOdometer: record.issueOdometer,
        tripIssuedAt: record.tripIssuedAt,
        authorityStatus: record.authorityStatus,
        request: {
          id: record.assignment.requestId,
          reference: record.requestReference,
          purpose: record.requestPurpose,
          status: record.requestStatus,
        },
        vehicle: {
          licenceNumber: record.vehicleLicenceNumber,
          registerNumber: record.vehicleRegisterNumber,
          make: record.vehicleMake,
          model: record.vehicleModel,
          currentOdometer: record.vehicleCurrentOdometer,
        },
        period: { startAt: record.allocationStartAt, endAt: record.allocationEndAt },
        allocationState: record.allocationState,
        tripStatus: record.tripStatus,
        driver: {
          id: record.assignment.externalPartyId,
          name: `${record.driverFirstName} ${record.driverLastName}`.trim(),
          organisation: record.driverOrganisation,
          phone: record.driverPhone,
          email: record.driverEmail,
        },
        licence: {
          id: record.assignment.licenceId,
          number: record.licenceNumber,
          class: record.licenceClass,
          expiryDate: record.licenceExpiry,
          verificationStatus: record.licenceStatus,
        },
      },
    });
  } catch (error) {
    console.error('[allocations/external/detail] GET failed:', error);
    return NextResponse.json({ error: 'External driver assignment could not be loaded' }, { status: 500 });
  }
}
