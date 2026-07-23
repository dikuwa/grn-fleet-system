/**
 * Allocation Action API
 *
 * POST /api/allocations/[id]/action  — Perform an action on an allocation
 *
 * Actions:
 *   - confirm: Confirm a provisional allocation
 *   - cancel: Cancel an allocation
 *   - release: Mark as released (vehicle physically issued)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleAllocations, trips } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, gt, lt, inArray, ne, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const VALID_TRANSITIONS: Record<string, string[]> = {
  provisional: ['confirmed', 'cancelled'],
  confirmed: ['cancelled'],
  issued: [],
  cancelled: [],
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { actionType, vehicleId: replacementVehicleId, reason } = body;

    if (!actionType || typeof actionType !== 'string') {
      return NextResponse.json({ error: 'actionType is required (confirm, cancel, release)' }, { status: 400 });
    }

    const db = getDb();

    // Verify allocation exists and belongs to this tenant
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        vehicleId: vehicleAllocations.vehicleId,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    if (actionType === 'replace_vehicle') {
      if (!['provisional', 'confirmed'].includes(allocation.state)) return NextResponse.json({ error: 'Vehicle replacement is only allowed before physical issue' }, { status: 409 });
      if (!replacementVehicleId || !reason?.trim()) return NextResponse.json({ error: 'Replacement vehicle and reason are required' }, { status: 400 });
      const [replacement] = await db.select({ id: vehicles.id, status: vehicles.status }).from(vehicles)
        .where(and(eq(vehicles.id, replacementVehicleId), eq(vehicles.tenantId, session.tenantId))).limit(1);
      if (!replacement || replacement.status !== 'available') return NextResponse.json({ error: 'Replacement vehicle is not available in this tenant' }, { status: 409 });
      const [conflict] = await db.select({ id: vehicleAllocations.id }).from(vehicleAllocations).where(and(
        eq(vehicleAllocations.vehicleId, replacementVehicleId), ne(vehicleAllocations.id, allocation.id),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
        lt(vehicleAllocations.startAt, allocation.endAt), gt(vehicleAllocations.endAt, allocation.startAt),
      )).limit(1);
      if (conflict) return NextResponse.json({ error: 'Replacement vehicle is already allocated during this period' }, { status: 409 });
      await db.update(vehicleAllocations).set({ vehicleId: replacementVehicleId, overrideReason: reason.trim(), version: sql`${vehicleAllocations.version} + 1`, updatedAt: new Date() }).where(eq(vehicleAllocations.id, id));
      await db.update(trips).set({ vehicleId: replacementVehicleId, version: sql`${trips.version} + 1`, updatedAt: new Date() }).where(eq(trips.allocationId, id));
      await db.insert(auditEvents).values({ tenantId: session.tenantId, tenantSequence: Date.now(), eventType: 'allocation_vehicle_replaced', actorUserId: session.user.id, action: 'replace_vehicle', entityType: 'allocation', entityId: id, summary: `Allocation vehicle replaced: ${allocation.vehicleId} → ${replacementVehicleId}`, before: { vehicleId: allocation.vehicleId }, after: { vehicleId: replacementVehicleId, reason } });
      return NextResponse.json({ success: true, vehicleId: replacementVehicleId });
    }

    // Validate state transition
    const allowedTransitions = VALID_TRANSITIONS[allocation.state] || [];
    if (!allowedTransitions.includes(actionType)) {
      return NextResponse.json(
        { error: `Cannot ${actionType} an allocation in '${allocation.state}' state` },
        { status: 400 },
      );
    }

    const newState = actionType;

    await db
      .update(vehicleAllocations)
      .set({ state: newState, updatedAt: new Date() })
      .where(eq(vehicleAllocations.id, id));

    await db.insert(auditEvents).values({ tenantId: session.tenantId, tenantSequence: Date.now(), eventType: `allocation_${newState}`, actorUserId: session.user.id, action: newState, entityType: 'allocation', entityId: id, summary: `Allocation state changed from ${allocation.state} to ${newState}` });

    return NextResponse.json({ success: true, state: newState });
  } catch (error) {
    console.error('[Allocation Action] POST failed:', error);
    return NextResponse.json({ error: 'Failed to process allocation action' }, { status: 500 });
  }
}
