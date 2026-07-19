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
import { vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const VALID_TRANSITIONS: Record<string, string[]> = {
  provisional: ['confirmed', 'cancelled'],
  confirmed: ['released', 'cancelled'],
  released: ['cancelled'],
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
    const { actionType } = body;

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
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
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

    return NextResponse.json({ success: true, state: newState });
  } catch (error) {
    console.error('[Allocation Action] POST failed:', error);
    return NextResponse.json({ error: 'Failed to process allocation action' }, { status: 500 });
  }
}
