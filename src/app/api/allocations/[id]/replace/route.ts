/**
 * Vehicle Replacement API
 *
 * POST /api/allocations/[id]/replace
 *
 * Replaces the vehicle assigned to an allocation mid-trip (or pre-issue).
 * Records the original vehicle in `replacedFromVehicleId`, transfers
 * outstanding departure inspections, updates the trip, and writes audit
 * events. For mid-trip replacements an odometer handover reading is required.
 *
 * Body:
 *   replacementVehicleId (required) — the new vehicle id
 *   reason              (required) — free-text reason
 *   handoverOdometer    (optional) — odometer at swap point (required for mid-trip)
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  replaceVehicle,
  VehicleReplaceError,
} from '@/lib/allocations/vehicle-replacement';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const permCheck = await requirePermission(auth.session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { replacementVehicleId, reason, handoverOdometer } = body ?? {};

    const result = await replaceVehicle(
      {
        allocationId: id,
        replacementVehicleId,
        reason,
        handoverOdometer: handoverOdometer != null ? Number(handoverOdometer) : null,
      },
      auth.session,
    );

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof VehicleReplaceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Allocation Replace] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to replace vehicle' },
      { status: 500 },
    );
  }
}