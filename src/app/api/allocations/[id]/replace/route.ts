/**
 * Allocation Vehicle Replacement API
 *
 * POST /api/allocations/[id]/replace
 */

import { NextRequest, NextResponse } from 'next/server';
import { replaceVehicle, VehicleReplaceError } from '@/lib/allocations/vehicle-replacement';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const routeCheck = await requireDashboardAction(auth.session, '/dashboard/allocations', 'update');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permCheck = await requirePermission(auth.session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const {
      replacementVehicleId,
      reason,
      handoverOdometer,
      outgoingVehicleDisposition,
    } = body ?? {};
    const result = await replaceVehicle(
      {
        allocationId: id,
        replacementVehicleId,
        reason,
        handoverOdometer: handoverOdometer != null ? Number(handoverOdometer) : null,
        outgoingVehicleDisposition,
      },
      auth.session,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof VehicleReplaceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Allocation Replace] POST failed:', error);
    return NextResponse.json({ error: 'Failed to replace vehicle' }, { status: 500 });
  }
}
