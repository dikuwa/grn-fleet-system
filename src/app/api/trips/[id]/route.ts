/**
 * Trip Detail API
 *
 * GET /api/trips/[id] — Fetch a single trip with vehicle info
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  fuelTransactions,
  tripAuthorities,
  tripAuthorityPassengers,
  tripAuthorisedDrivers,
  tripExpenses,
  tripIncidents,
  tripProgressEntries,
  trips,
  vehicleAllocations,
  vehicleInspections,
} from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { employees } from '@/db/schema/people';
import { eq, and, sql } from 'drizzle-orm';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { tripScopeCondition } from '@/lib/record-scope';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid trip identifier' }, { status: 400 });
    }
    const auth = await requireRequestAuth(_req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'view');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/trips', roleNames);

    const permCheck = await requirePermission(session, Permissions.TRIP_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    const [trip] = await db
      .select({
        id: trips.id,
        status: trips.status,
        tenantId: trips.tenantId,
        requestId: trips.requestId,
        allocationId: trips.allocationId,
        vehicleId: trips.vehicleId,
        issuedAt: trips.issuedAt,
        startedAt: trips.startedAt,
        returnedAt: trips.returnedAt,
        closedAt: trips.closedAt,
        createdAt: trips.createdAt,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        requestReference: transportRequests.reference,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
      })
      .from(trips)
      .leftJoin(
        vehicles,
        and(eq(trips.vehicleId, vehicles.id), eq(vehicles.tenantId, session.tenantId)),
      )
      .leftJoin(
        transportRequests,
        and(
          eq(trips.requestId, transportRequests.id),
          eq(transportRequests.tenantId, session.tenantId),
        ),
      )
      .leftJoin(
        employees,
        and(
          eq(transportRequests.requesterEmployeeId, employees.id),
          eq(employees.tenantId, session.tenantId),
        ),
      )
      .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
      .where(
        and(
          eq(trips.id, id),
          tripScopeCondition({
            tenantId: session.tenantId,
            userId: session.user.id,
            recordScope: access.recordScope ?? 'assigned',
          }),
        ),
      )
      .limit(1);

    if (!trip) {
      return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }
    const [authority] = await db
      .select()
      .from(tripAuthorities)
      .where(and(eq(tripAuthorities.tripId, id), eq(tripAuthorities.tenantId, session.tenantId)))
      .limit(1);

    const [passengers, authorisedDrivers, progress, inspections, fuel, expenses, incidents] =
      authority
        ? await Promise.all([
            db
              .select()
              .from(tripAuthorityPassengers)
              .where(eq(tripAuthorityPassengers.authorityId, authority.id)),
            db
              .select({
                id: tripAuthorisedDrivers.id,
                employeeId: tripAuthorisedDrivers.employeeId,
                driverType: tripAuthorisedDrivers.driverType,
                employeeNumber: tripAuthorisedDrivers.employeeNumber,
                licenceNumberMasked: tripAuthorisedDrivers.licenceNumberMasked,
                licenceClass: tripAuthorisedDrivers.licenceClass,
                licenceExpiry: tripAuthorisedDrivers.licenceExpiry,
                firstName: employees.firstName,
                lastName: employees.lastName,
              })
              .from(tripAuthorisedDrivers)
              .innerJoin(
                employees,
                and(
                  eq(employees.id, tripAuthorisedDrivers.employeeId),
                  eq(employees.tenantId, session.tenantId),
                ),
              )
              .where(eq(tripAuthorisedDrivers.authorityId, authority.id)),
            db
              .select()
              .from(tripProgressEntries)
              .where(
                and(
                  eq(tripProgressEntries.tripId, id),
                  eq(tripProgressEntries.tenantId, session.tenantId),
                ),
              ),
            db
              .select()
              .from(vehicleInspections)
              .where(
                and(
                  eq(vehicleInspections.tripId, id),
                  eq(vehicleInspections.tenantId, session.tenantId),
                ),
              ),
            db
              .select()
              .from(fuelTransactions)
              .where(
                and(
                  eq(fuelTransactions.tripId, id),
                  sql`exists (
                    select 1 from vehicles tenant_vehicle
                    where tenant_vehicle.id = ${fuelTransactions.vehicleId}
                      and tenant_vehicle.tenant_id = ${session.tenantId}::uuid
                  )`,
                ),
              ),
            db
              .select()
              .from(tripExpenses)
              .where(and(eq(tripExpenses.tripId, id), eq(tripExpenses.tenantId, session.tenantId))),
            db
              .select()
              .from(tripIncidents)
              .where(
                and(eq(tripIncidents.tripId, id), eq(tripIncidents.tenantId, session.tenantId)),
              ),
          ])
        : [[], [], [], [], [], [], []];

    return NextResponse.json({
      success: true,
      trip,
      authority,
      passengers,
      authorisedDrivers,
      progress,
      inspections,
      fuel,
      expenses,
      incidents,
    });
  } catch (error) {
    console.error('[Trip Detail] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch trip' }, { status: 500 });
  }
}
