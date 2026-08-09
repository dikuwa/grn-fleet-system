import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  inspectionTemplateItems,
  inspectionTemplates,
  tripAuthorities,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const VALID_TYPES = ['departure', 'return'] as const;
type InspectionType = (typeof VALID_TYPES)[number];

/**
 * GET /api/inspections/context?type=departure|return
 *
 * Inspector-specific form context. This deliberately does not reuse the broad
 * /api/trips or /api/fleet list endpoints: Inspectors need only trips that are
 * currently eligible for an official inspection, plus the one active
 * server-owned checklist template for the selected inspection type.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(
      session,
      '/dashboard/inspections/new',
      'create',
    );
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permissionCheck = await requirePermission(session, Permissions.INSPECTION_PERFORM);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const requestedType = new URL(request.url).searchParams.get('type') || 'departure';
    if (!VALID_TYPES.includes(requestedType as InspectionType)) {
      return NextResponse.json({ error: 'Inspection type must be departure or return' }, { status: 400 });
    }
    const type = requestedType as InspectionType;

    const db = getDb();
    const [activeTemplate] = await db
      .select({
        id: inspectionTemplates.id,
        name: inspectionTemplates.name,
        type: inspectionTemplates.type,
        version: inspectionTemplates.version,
      })
      .from(inspectionTemplates)
      .where(
        and(
          eq(inspectionTemplates.tenantId, session.tenantId),
          eq(inspectionTemplates.type, type),
          eq(inspectionTemplates.isActive, true),
        ),
      )
      .orderBy(inspectionTemplates.version)
      .limit(1);

    if (!activeTemplate) {
      return NextResponse.json(
        { error: `No active ${type} inspection template is configured` },
        { status: 409 },
      );
    }

    const templateItems = await db
      .select({
        id: inspectionTemplateItems.id,
        sortOrder: inspectionTemplateItems.sortOrder,
        category: inspectionTemplateItems.category,
        label: inspectionTemplateItems.label,
        requiresPhoto: inspectionTemplateItems.requiresPhoto,
        isCritical: inspectionTemplateItems.isCritical,
      })
      .from(inspectionTemplateItems)
      .where(eq(inspectionTemplateItems.templateId, activeTemplate.id))
      .orderBy(asc(inspectionTemplateItems.sortOrder));

    if (templateItems.length === 0) {
      return NextResponse.json(
        { error: `The active ${type} inspection template has no checklist items` },
        { status: 409 },
      );
    }

    const lifecycleStatuses = type === 'departure'
      ? ['pending']
      : ['in_progress', 'return_due', 'return_inspection'];

    const tripRows = await db
      .select({
        id: trips.id,
        status: trips.status,
        vehicleId: trips.vehicleId,
        requestReference: transportRequests.reference,
        requestStatus: transportRequests.status,
        authorityStatus: tripAuthorities.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        currentOdometer: vehicles.currentOdometer,
      })
      .from(trips)
      .innerJoin(transportRequests, eq(transportRequests.id, trips.requestId))
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .innerJoin(vehicles, eq(vehicles.id, trips.vehicleId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(
        and(
          eq(trips.tenantId, session.tenantId),
          eq(transportRequests.tenantId, session.tenantId),
          eq(vehicles.tenantId, session.tenantId),
          inArray(trips.status, lifecycleStatuses),
        ),
      )
      .orderBy(trips.createdAt);

    const tripsEligible = tripRows.filter((trip) => {
      if (!trip.driverEmployeeId) return false;
      if (type === 'departure') {
        return (
          ['authorised', 'ready_for_issue', 'approved', 'approved_emergency'].includes(trip.requestStatus) &&
          ['driver_accepted', 'awaiting_pre_trip_inspection'].includes(trip.authorityStatus)
        );
      }
      return ['awaiting_arrival_inspection', 'returned'].includes(trip.authorityStatus);
    });

    const vehicleMap = new Map<string, {
      id: string;
      licenceNumber: string;
      make: string;
      model: string;
      currentOdometer: number;
    }>();
    for (const trip of tripsEligible) {
      vehicleMap.set(trip.vehicleId, {
        id: trip.vehicleId,
        licenceNumber: trip.licenceNumber,
        make: trip.make,
        model: trip.model,
        currentOdometer: trip.currentOdometer,
      });
    }

    return NextResponse.json(
      {
        type,
        template: { ...activeTemplate, items: templateItems },
        requiredPhotoCount: templateItems.filter((item) => item.requiresPhoto).length,
        trips: tripsEligible,
        vehicles: Array.from(vehicleMap.values()),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[inspections/context] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load inspection context' }, { status: 500 });
  }
}
