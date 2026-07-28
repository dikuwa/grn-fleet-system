import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleAllocations, trips } from '@/db/schema/trips';
import { transportRequests } from '@/db/schema/requests';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onTripIssued } from '@/lib/document-generator';
import { VehicleRecommender } from '@/lib/vehicle-recommender';
import { eq, and, lt, gt, inArray } from 'drizzle-orm';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/allocations', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const {
      requestId,
      requestReference,
      vehicleId,
      vehicleGrn,
      startDate,
      endDate,
    } = body;

    // Accept UUID or string reference for request
    let resolvedRequestId = requestId;
    let resolvedVehicleId = vehicleId;

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    // Look up request by reference if not a UUID
    if (!resolvedRequestId && requestReference) {
      const [found] = await db
        .select({ id: transportRequests.id })
        .from(transportRequests)
        .where(and(eq(transportRequests.reference, requestReference), eq(transportRequests.tenantId, tenantId)))
        .limit(1);
      if (found) resolvedRequestId = found.id;
    }

    // Look up vehicle by GRN number if not a UUID
    if (!resolvedVehicleId && vehicleGrn) {
      const [found] = await db
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(and(eq(vehicles.licenceNumber, vehicleGrn), eq(vehicles.tenantId, tenantId)))
        .limit(1);
      if (found) resolvedVehicleId = found.id;
    }

    // If no vehicle specified or recommendAuto is set, auto-recommend
    let recommendation: Awaited<ReturnType<VehicleRecommender['findBestMatch']>> | null = null;

    if (!resolvedVehicleId || body.recommendAuto) {
      const recommender = new VehicleRecommender({ db });
      recommendation = await recommender.findBestMatch(resolvedRequestId);

      if (recommendation.topVariant) {
        if (!resolvedVehicleId) {
          // Auto-select the best match when no vehicle is specified
          resolvedVehicleId = recommendation.topVariant.vehicleId;
        }
        // If vehicle was explicitly provided but recommendAuto is on, we keep
        // the explicit choice but still return the recommendation data
      }
    }

    // Validate required fields
    if (!resolvedRequestId) {
      return NextResponse.json({ error: 'Request ID or reference is required' }, { status: 400 });
    }
    if (!resolvedVehicleId) {
      const errorMsg =
        recommendation && recommendation.totalAvailable === 0
          ? 'No available vehicles found for this request. No auto-recommendation possible.'
          : 'Vehicle ID or GRN is required. Use recommendAuto: true for auto-selection.';
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }
    if (!startDate) {
      return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    }

    // Verify the transport request exists
    const [foundReq] = await db
      .select({ id: transportRequests.id, status: transportRequests.status, reference: transportRequests.reference })
      .from(transportRequests)
      .where(and(eq(transportRequests.id, resolvedRequestId), eq(transportRequests.tenantId, tenantId)))
      .limit(1);

    if (!foundReq) {
      return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    }
    if (!['transport_review', 'release_pending', 'vehicle_allocated'].includes(foundReq.status)) {
      return NextResponse.json({ error: `Request cannot be allocated while status is "${foundReq.status}"` }, { status: 409 });
    }

    // Verify the vehicle exists
    const [vehicle] = await db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(and(eq(vehicles.id, resolvedVehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }
    if (vehicle.status !== 'available') {
      return NextResponse.json({ error: `Vehicle is not available (status: ${vehicle.status})` }, { status: 409 });
    }

    const startAt = new Date(startDate);
    const endAt = endDate ? new Date(endDate) : new Date(startAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (!Number.isFinite(startAt.getTime()) || !Number.isFinite(endAt.getTime()) || endAt <= startAt) {
      return NextResponse.json({ error: 'Allocation dates are invalid' }, { status: 400 });
    }

    const [overlap] = await db.select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .where(and(
        eq(vehicleAllocations.vehicleId, resolvedVehicleId),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
        lt(vehicleAllocations.startAt, endAt),
        gt(vehicleAllocations.endAt, startAt),
      ))
      .limit(1);
    if (overlap) {
      return NextResponse.json({ error: 'Vehicle is already allocated during this period' }, { status: 409 });
    }

    // Create the allocation
    const [allocation] = await db
      .insert(vehicleAllocations)
      .values({
        requestId: resolvedRequestId,
        vehicleId: resolvedVehicleId,
        startAt,
        endAt,
        state: 'confirmed',
        allocatedByUserId: userId,
      })
      .returning();

    // Create the trip record
    const [trip] = await db
      .insert(trips)
      .values({
        tenantId,
        requestId: resolvedRequestId,
        allocationId: allocation.id,
        vehicleId: resolvedVehicleId,
        status: 'pending',
      })
      .returning();

    // Trigger document generation (trip authority)
    const doc = await onTripIssued(allocation.id, tenantId, userId);

    // Audit log
    await db.insert(auditEvents).values({
      tenantId,
      tenantSequence: 0,
      eventType: 'allocation_created',
      actorUserId: userId,
      action: 'create',
      entityType: 'allocation',
      entityId: allocation.id,
      summary: `Allocation created: request ${resolvedRequestId?.slice(0, 8)} → vehicle ${resolvedVehicleId?.slice(0, 8)}`,
      sourceChannel: 'web',
    });
    await recordTenantRequestActivity({
      tenantId,
      requestId: foundReq.id,
      reference: foundReq.reference,
      stage: 'allocated',
      officeLabel: 'Transport office',
    });

    return NextResponse.json({ allocation, trip, document: doc, recommendation });
  } catch (error) {
    console.error('[allocations] POST failed:', error);
    if ((error as { code?: string })?.code === '23P01') {
      return NextResponse.json({ error: 'Vehicle is already allocated during this period' }, { status: 409 });
    }
    return NextResponse.json(
      { error: 'Failed to create allocation' },
      { status: 500 },
    );
  }
}
