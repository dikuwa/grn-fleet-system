import { NextRequest, NextResponse } from 'next/server';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  inspectionTemplateItems,
  inspectionTemplates,
  tripAuthorities,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { externalDriverAssignments } from '@/db/schema/external-driver-assignments';
import { externalParties } from '@/db/schema/external-parties';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const VALID_TYPES = ['departure', 'return'] as const;
type InspectionType = (typeof VALID_TYPES)[number];

/**
 * Inspector-specific form context. Exposes only lifecycle-eligible trips and
 * the active server-owned checklist template; it does not grant Inspectors the
 * general Trips or Fleet administration workspaces.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/inspections/new', 'create');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permissionCheck = await requirePermission(session, Permissions.INSPECTION_PERFORM);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const requestedType = new URL(request.url).searchParams.get('type') || 'departure';
    if (!VALID_TYPES.includes(requestedType as InspectionType)) {
      return NextResponse.json({ error: 'Inspection type must be departure or return' }, { status: 400 });
    }
    const type = requestedType as InspectionType;
    const db = getDb();

    // Legacy data may contain more than one active template. Until the template
    // management invariant is repaired, both form context and POST validation
    // deterministically use the newest active version.
    const [activeTemplate] = await db.select({
      id: inspectionTemplates.id,
      name: inspectionTemplates.name,
      type: inspectionTemplates.type,
      version: inspectionTemplates.version,
    }).from(inspectionTemplates).where(and(
      eq(inspectionTemplates.tenantId, session.tenantId),
      eq(inspectionTemplates.type, type),
      eq(inspectionTemplates.isActive, true),
    )).orderBy(desc(inspectionTemplates.version)).limit(1);

    if (!activeTemplate) {
      return NextResponse.json({ error: `No active ${type} inspection template is configured` }, { status: 409 });
    }

    const templateItems = await db.select({
      id: inspectionTemplateItems.id,
      sortOrder: inspectionTemplateItems.sortOrder,
      category: inspectionTemplateItems.category,
      label: inspectionTemplateItems.label,
      requiresPhoto: inspectionTemplateItems.requiresPhoto,
      isCritical: inspectionTemplateItems.isCritical,
    }).from(inspectionTemplateItems)
      .where(eq(inspectionTemplateItems.templateId, activeTemplate.id))
      .orderBy(asc(inspectionTemplateItems.sortOrder));

    if (!templateItems.length) {
      return NextResponse.json({ error: `The active ${type} inspection template has no checklist items` }, { status: 409 });
    }

    const lifecycleStatuses = type === 'departure'
      ? ['pending']
      : ['in_progress', 'return_due', 'return_inspection'];

    const [tripRows, acceptedExternalRows] = await Promise.all([
      db.select({
        id: trips.id,
        status: trips.status,
        vehicleId: trips.vehicleId,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        authorityStatus: tripAuthorities.status,
        authorityNumber: tripAuthorities.authorityNumber,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        driverName: sql<string | null>`(
          select trim(concat(coalesce(e.first_name, ''), ' ', coalesce(e.last_name, '')))
          from employees e
          where e.id = ${vehicleAllocations.driverEmployeeId}
            and e.tenant_id = ${session.tenantId}
          limit 1
        )`,
        originName: sql<string | null>`(
          select rr.origin_name from request_routes rr
          where rr.request_id = ${trips.requestId}
          order by rr.created_at asc limit 1
        )`,
        destinationName: sql<string | null>`(
          select rr.destination_name from request_routes rr
          where rr.request_id = ${trips.requestId}
          order by rr.created_at desc limit 1
        )`,
        departureAt: vehicleAllocations.startAt,
        returnAt: vehicleAllocations.endAt,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        currentOdometer: vehicles.currentOdometer,
      }).from(trips)
        .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
        .innerJoin(
          vehicleAllocations,
          and(
            eq(vehicleAllocations.id, trips.allocationId),
            eq(vehicleAllocations.requestId, trips.requestId),
            eq(vehicleAllocations.vehicleId, trips.vehicleId),
            eq(vehicleAllocations.state, 'confirmed'),
          ),
        )
        .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
        .innerJoin(
          tripAuthorities,
          and(
            eq(tripAuthorities.tripId, trips.id),
            eq(tripAuthorities.requestId, trips.requestId),
            eq(tripAuthorities.allocationId, trips.allocationId),
          ),
        )
        .where(and(
          eq(trips.tenantId, session.tenantId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(vehicles.tenantId, session.tenantId),
          eq(tripAuthorities.tenantId, session.tenantId),
          inArray(trips.status, lifecycleStatuses),
        ))
        .orderBy(trips.createdAt),
      db
        .select({
          tripId: externalDriverAssignments.tripId,
          issueId: externalDriverAssignments.issueId,
          driverName: sql<string>`trim(concat(${externalParties.firstName}, ' ', ${externalParties.lastName}))`,
        })
        .from(externalDriverAssignments)
        .innerJoin(
          externalParties,
          and(
            eq(externalParties.id, externalDriverAssignments.externalPartyId),
            eq(externalParties.tenantId, session.tenantId),
          ),
        )
        .where(
          and(
            eq(externalDriverAssignments.tenantId, session.tenantId),
            eq(externalDriverAssignments.state, 'accepted'),
          ),
        ),
    ]);

    const acceptedExternalByTrip = new Map(
      acceptedExternalRows.map((row) => [row.tripId, { issueId: row.issueId, driverName: row.driverName }]),
    );

    const eligibleTrips = tripRows
      .filter((trip) => {
        const external = acceptedExternalByTrip.get(trip.id);
        const hasValidDriver = Boolean(trip.driverEmployeeId || external);
        if (!hasValidDriver) return false;
        if (type === 'departure') {
          return (
            ['authorised', 'ready_for_issue', 'approved', 'approved_emergency'].includes(trip.requestStatus) &&
            ['driver_accepted', 'awaiting_pre_trip_inspection'].includes(trip.authorityStatus)
          );
        }
        return (
          ['returned', 'awaiting_arrival_inspection'].includes(trip.authorityStatus) &&
          (trip.driverEmployeeId ? true : Boolean(external?.issueId))
        );
      })
      .map((trip) => ({
        ...trip,
        driverKind: trip.driverEmployeeId ? ('internal' as const) : ('external' as const),
        driverName: trip.driverEmployeeId
          ? trip.driverName
          : acceptedExternalByTrip.get(trip.id)?.driverName || null,
      }));

    const vehicleMap = new Map<string, {
      id: string;
      licenceNumber: string;
      make: string;
      model: string;
      currentOdometer: number;
    }>();
    for (const trip of eligibleTrips) {
      vehicleMap.set(trip.vehicleId, {
        id: trip.vehicleId,
        licenceNumber: trip.licenceNumber,
        make: trip.make,
        model: trip.model,
        currentOdometer: trip.currentOdometer,
      });
    }

    return NextResponse.json({
      type,
      template: { ...activeTemplate, items: templateItems },
      requiredPhotoCount: templateItems.filter((item) => item.requiresPhoto).length,
      trips: eligibleTrips,
      vehicles: Array.from(vehicleMap.values()),
    }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[inspections/context] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load inspection context' }, { status: 500 });
  }
}
