import { NextRequest, NextResponse } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripAuthorisedDrivers,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/driver-mobile', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;

    const db = getDb();
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
    if (!employee) return NextResponse.json({ success: true, data: [] });

    const rows = await db
      .select({
        tripId: trips.id,
        tripStatus: trips.status,
        requestReference: transportRequests.reference,
        purpose: transportRequests.purpose,
        vehicleLicence: vehicles.licenceNumber,
        vehicleMake: vehicles.make,
        vehicleModel: vehicles.model,
        currentDriverEmployeeId: vehicleAllocations.driverEmployeeId,
        takeoverOdometer: tripAuthorisedDrivers.takeoverOdometer,
        reason: tripAuthorisedDrivers.reason,
        authorisedAt: tripAuthorisedDrivers.authorisedAt,
        validUntil: tripAuthorities.validUntil,
        origin: tripAuthorities.origin,
        destination: tripAuthorities.destination,
        approvedRoute: tripAuthorities.approvedRoute,
        specialConditions: tripAuthorities.specialConditions,
      })
      .from(tripAuthorisedDrivers)
      .innerJoin(tripAuthorities, eq(tripAuthorities.id, tripAuthorisedDrivers.authorityId))
      .innerJoin(trips, eq(trips.id, tripAuthorities.tripId))
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .where(
        and(
          eq(tripAuthorisedDrivers.employeeId, employee.id),
          eq(tripAuthorisedDrivers.driverType, 'relief'),
          isNull(tripAuthorisedDrivers.acknowledgedAt),
          eq(trips.tenantId, session.tenantId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(tripAuthorities.tenantId, session.tenantId),
          eq(vehicles.tenantId, session.tenantId),
          eq(vehicleAllocations.state, 'confirmed'),
        ),
      );

    return NextResponse.json({
      success: true,
      data: rows.filter(
        (row) =>
          ['in_progress', 'return_due'].includes(row.tripStatus) &&
          row.currentDriverEmployeeId !== employee.id,
      ),
    });
  } catch (error) {
    console.error('[trips/driver-handovers] GET failed:', error);
    return NextResponse.json({ error: 'Could not load pending driver handovers' }, { status: 500 });
  }
}
