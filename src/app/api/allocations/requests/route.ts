/**
 * Searchable eligible-request selector for the Vehicle Allocation flow.
 *
 * GET /api/allocations/requests?q=&page=&limit=
 *
 * Returns tenant-scoped transport requests that are eligible for a new
 * allocation. Only human-readable fields are returned — officers never need
 * to know internal UUIDs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  transportRequests,
  requestRoutes,
  requestActivities,
  requestPassengers,
  requestDrivers,
} from '@/db/schema/requests';
import { vehicleAllocations } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import {
  requireAnyPermission,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

/** Statuses where Transport Administration may still allocate a vehicle. */
const ALLOCATABLE_STATUSES = [
  'approved',
  'under_review',
  'transport_review',
  'release_pending',
  'vehicle_allocated',
];

/** Allocation states that consume the request (i.e. already handled). */
const ACTIVE_ALLOCATION_STATES = ['provisional', 'confirmed', 'issued'] as const;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const roleCheck = await requireDashboardAction(session, '/dashboard/allocations', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requireAnyPermission(session, [
      Permissions.ALLOCATION_MANAGE,
      Permissions.ALLOCATION_CREATE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || '';
    const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || '10') || 10));

    const db = getDb();
    const tenantId = session.tenantId;

    const conditions = [
      eq(transportRequests.tenantId, tenantId),
      inArray(transportRequests.status, ALLOCATABLE_STATUSES),
    ];
    if (q) {
      conditions.push(
        or(
          ilike(transportRequests.reference, `%${q}%`),
          ilike(employees.firstName, `%${q}%`),
          ilike(employees.lastName, `%${q}%`),
          ilike(employees.employeeNumber, `%${q}%`),
        )!,
      );
    }

    const base = db
      .select({
        id: transportRequests.id,
        reference: transportRequests.reference,
        status: transportRequests.status,
        scope: transportRequests.scope,
        purpose: transportRequests.purpose,
        urgency: transportRequests.urgency,
        overnight: transportRequests.overnight,
        specialRequirements: transportRequests.specialRequirements,
        vehicleRequirements: transportRequests.vehicleRequirements,
        preferredDriverEmployeeId: transportRequests.preferredDriverEmployeeId,
        requesterName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
        requesterEmployeeNumber: employees.employeeNumber,
      })
      .from(transportRequests)
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(and(...conditions));

    const [countRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transportRequests)
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(and(...conditions));

    const rows = await base
      .orderBy(desc(transportRequests.createdAt))
      .offset((page - 1) * limit)
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;
    const pageIds = pageRows.map((row) => row.id);

    const [routes, activities, passengerCounts, nominated, activeAllocations] =
      await Promise.all([
        db
          .select({
            requestId: requestRoutes.requestId,
            originName: requestRoutes.originName,
            destinationName: requestRoutes.destinationName,
            totalKilometres: requestRoutes.totalKilometres,
            mappedDistanceKm: requestRoutes.mappedDistanceKm,
          })
          .from(requestRoutes)
          .where(inArray(requestRoutes.requestId, pageIds))
          .orderBy(asc(requestRoutes.createdAt)),
        db
          .select({
            requestId: requestActivities.requestId,
            startDate: requestActivities.startDate,
            endDate: requestActivities.endDate,
          })
          .from(requestActivities)
          .where(inArray(requestActivities.requestId, pageIds)),
        db
          .select({
            requestId: requestPassengers.requestId,
            count: sql<number>`count(*)`,
          })
          .from(requestPassengers)
          .where(inArray(requestPassengers.requestId, pageIds))
          .groupBy(requestPassengers.requestId),
        db
          .select({
            requestId: requestDrivers.requestId,
            employeeId: requestDrivers.employeeId,
            driverType: requestDrivers.driverType,
            isConfirmed: requestDrivers.isConfirmed,
            driverName: sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
          })
          .from(requestDrivers)
          .innerJoin(employees, eq(requestDrivers.employeeId, employees.id))
          .where(
            and(
              inArray(requestDrivers.requestId, pageIds),
              eq(requestDrivers.driverType, 'nominated'),
            ),
          ),
        db
          .select({
            requestId: vehicleAllocations.requestId,
            state: vehicleAllocations.state,
          })
          .from(vehicleAllocations)
          .where(
            and(
              inArray(vehicleAllocations.requestId, pageIds),
              inArray(vehicleAllocations.state, [...ACTIVE_ALLOCATION_STATES]),
            ),
          ),
      ]);

    const routeMap = new Map<string, (typeof routes)[number]>();
    for (const route of routes) {
      if (!routeMap.has(route.requestId)) routeMap.set(route.requestId, route);
    }
    const activityMap = new Map<string, { startDate: Date; endDate: Date }>();
    for (const activity of activities) {
      const current = activityMap.get(activity.requestId);
      if (!current) {
        activityMap.set(activity.requestId, {
          startDate: activity.startDate,
          endDate: activity.endDate,
        });
      } else {
        if (activity.startDate < current.startDate) current.startDate = activity.startDate;
        if (activity.endDate > current.endDate) current.endDate = activity.endDate;
      }
    }
    const passengerMap = new Map(passengerCounts.map((row) => [row.requestId, row.count]));
    const nominatedMap = new Map<string, string>();
    for (const driver of nominated) {
      if (!nominatedMap.has(driver.requestId)) {
        nominatedMap.set(driver.requestId, driver.driverName);
      }
    }
    const allocated = new Set(activeAllocations.map((row) => row.requestId));

    const data = pageRows
      .filter((row) => !allocated.has(row.id))
      .map((row) => {
        const route = routeMap.get(row.id);
        const dates = activityMap.get(row.id);
        return {
          id: row.id,
          reference: row.reference,
          status: row.status,
          scope: row.scope,
          purpose: row.purpose ?? null,
          requesterName: row.requesterName ?? null,
          requesterEmployeeNumber: row.requesterEmployeeNumber ?? null,
          origin: route?.originName ?? null,
          destination: route?.destinationName ?? null,
          estimatedKm:
            route?.totalKilometres ?? route?.mappedDistanceKm ?? null,
          startDate: dates?.startDate.toISOString() ?? null,
          endDate: dates?.endDate.toISOString() ?? null,
          passengerCount: passengerMap.get(row.id) ?? 0,
          preferredDriverEmployeeId: row.preferredDriverEmployeeId ?? null,
          nominatedDriverName: nominatedMap.get(row.id) ?? null,
          urgency: row.urgency,
          overnight: row.overnight,
          specialRequirements: row.specialRequirements ?? null,
          vehicleRequirements: row.vehicleRequirements ?? null,
        };
      });

    return NextResponse.json({
      success: true,
      data,
      total: Number(countRow?.count ?? 0),
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(Number(countRow?.count ?? 0) / limit)),
      hasMore,
    });
  } catch (error) {
    console.error('[allocations/requests] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load eligible requests' }, { status: 500 });
  }
}
