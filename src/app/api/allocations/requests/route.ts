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
  externalRequestDrivers,
} from '@/db/schema/requests';
import { externalParties } from '@/db/schema/external-parties';
import { vehicleAllocations } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
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

/** Canonical allocation states that still consume a request. */
const ACTIVE_ALLOCATION_STATES = ['provisional', 'confirmed', 'released'] as const;

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
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || '10') || 10));

    const db = getDb();
    const tenantId = session.tenantId;

    const conditions: SQL[] = [
      eq(transportRequests.tenantId, tenantId),
      inArray(transportRequests.status, ALLOCATABLE_STATUSES),
      sql`not exists (
        select 1
        from ${vehicleAllocations}
        where ${vehicleAllocations.requestId} = ${transportRequests.id}
          and ${vehicleAllocations.state} in (${sql.join(
            ACTIVE_ALLOCATION_STATES.map((state) => sql`${state}`),
            sql`, `,
          )})
      )`,
    ];
    if (q) {
      conditions.push(
        or(
          ilike(transportRequests.reference, `%${q}%`),
          ilike(transportRequests.purpose, `%${q}%`),
          ilike(employees.firstName, `%${q}%`),
          ilike(employees.lastName, `%${q}%`),
          ilike(employees.employeeNumber, `%${q}%`),
          ilike(externalParties.firstName, `%${q}%`),
          ilike(externalParties.lastName, `%${q}%`),
          ilike(externalParties.organisationName, `%${q}%`),
        )!,
      );
    }
    const where = and(...conditions);

    const requesterJoins = <T extends ReturnType<typeof db.select>>(query: T) =>
      query
        .leftJoin(
          employees,
          and(
            eq(transportRequests.requesterEmployeeId, employees.id),
            eq(employees.tenantId, tenantId),
          ),
        )
        .leftJoin(
          externalParties,
          and(
            eq(transportRequests.externalRequesterId, externalParties.id),
            eq(externalParties.tenantId, tenantId),
          ),
        );

    const countQuery = requesterJoins(
      db.select({ count: sql<number>`count(*)` }).from(transportRequests),
    );
    const rowsQuery = requesterJoins(
      db
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
          requesterType: transportRequests.requesterType,
          preferredDriverEmployeeId: transportRequests.preferredDriverEmployeeId,
          preferredDriverExternalPartyId: transportRequests.preferredDriverExternalPartyId,
          internalRequesterFirstName: employees.firstName,
          internalRequesterLastName: employees.lastName,
          requesterEmployeeNumber: employees.employeeNumber,
          externalRequesterFirstName: externalParties.firstName,
          externalRequesterLastName: externalParties.lastName,
          externalRequesterOrganisation: externalParties.organisationName,
        })
        .from(transportRequests),
    );

    const [[countRow], rows] = await Promise.all([
      countQuery.where(where),
      rowsQuery
        .where(where)
        .orderBy(desc(transportRequests.createdAt))
        .offset((page - 1) * limit)
        .limit(limit),
    ]);

    const total = Number(countRow?.count ?? 0);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageIds = rows.map((row) => row.id);

    if (!pageIds.length) {
      return NextResponse.json({
        success: true,
        data: [],
        total,
        page,
        limit,
        totalPages,
        hasMore: page < totalPages,
      });
    }

    const [routes, activities, passengerCounts, nominatedInternal, nominatedExternal] = await Promise.all([
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
        .innerJoin(
          employees,
          and(
            eq(requestDrivers.employeeId, employees.id),
            eq(employees.tenantId, tenantId),
          ),
        )
        .where(
          and(
            inArray(requestDrivers.requestId, pageIds),
            eq(requestDrivers.driverType, 'nominated'),
          ),
        ),
      db
        .select({
          requestId: externalRequestDrivers.requestId,
          externalPartyId: externalRequestDrivers.externalPartyId,
          driverType: externalRequestDrivers.driverType,
          isConfirmed: externalRequestDrivers.isConfirmed,
          driverName: sql<string>`concat(${externalParties.firstName}, ' ', ${externalParties.lastName})`,
          organisation: externalParties.organisationName,
        })
        .from(externalRequestDrivers)
        .innerJoin(
          externalParties,
          and(
            eq(externalRequestDrivers.externalPartyId, externalParties.id),
            eq(externalParties.tenantId, tenantId),
          ),
        )
        .where(
          and(
            inArray(externalRequestDrivers.requestId, pageIds),
            eq(externalRequestDrivers.driverType, 'nominated'),
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
    const nominatedMap = new Map<string, { name: string; external: boolean; organisation?: string | null }>();
    for (const driver of nominatedInternal) {
      if (!nominatedMap.has(driver.requestId)) {
        nominatedMap.set(driver.requestId, { name: driver.driverName, external: false });
      }
    }
    for (const driver of nominatedExternal) {
      if (!nominatedMap.has(driver.requestId)) {
        nominatedMap.set(driver.requestId, {
          name: driver.driverName,
          external: true,
          organisation: driver.organisation,
        });
      }
    }

    const data = rows.map((row) => {
      const route = routeMap.get(row.id);
      const dates = activityMap.get(row.id);
      const external = row.requesterType === 'external';
      const requesterName = external
        ? `${row.externalRequesterFirstName || ''} ${row.externalRequesterLastName || ''}`.trim()
        : `${row.internalRequesterFirstName || ''} ${row.internalRequesterLastName || ''}`.trim();
      const nominatedDriver = nominatedMap.get(row.id);
      return {
        id: row.id,
        reference: row.reference,
        status: row.status,
        scope: row.scope,
        purpose: row.purpose ?? null,
        requesterType: external ? 'external' : 'internal',
        requesterName: requesterName || null,
        requesterEmployeeNumber: external ? null : row.requesterEmployeeNumber ?? null,
        requesterOrganisation: external ? row.externalRequesterOrganisation ?? null : null,
        origin: route?.originName ?? null,
        destination: route?.destinationName ?? null,
        estimatedKm: route?.totalKilometres ?? route?.mappedDistanceKm ?? null,
        startDate: dates?.startDate.toISOString() ?? null,
        endDate: dates?.endDate.toISOString() ?? null,
        passengerCount: Number(passengerMap.get(row.id) ?? 0),
        preferredDriverEmployeeId: row.preferredDriverEmployeeId ?? null,
        preferredDriverExternalPartyId: row.preferredDriverExternalPartyId ?? null,
        nominatedDriverName: nominatedDriver?.name ?? null,
        nominatedDriverExternal: nominatedDriver?.external ?? false,
        nominatedDriverOrganisation: nominatedDriver?.organisation ?? null,
        urgency: row.urgency,
        overnight: row.overnight,
        specialRequirements: row.specialRequirements ?? null,
        vehicleRequirements: row.vehicleRequirements ?? null,
      };
    });

    return NextResponse.json({
      success: true,
      data,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    });
  } catch (error) {
    console.error('[allocations/requests] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load eligible requests' }, { status: 500 });
  }
}