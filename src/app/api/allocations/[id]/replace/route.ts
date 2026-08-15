/**
 * Allocation Vehicle Replacement API
 *
 * POST /api/allocations/[id]/replace
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { trips } from '@/db/schema/trips';
import { replaceVehicle, VehicleReplaceError } from '@/lib/allocations/vehicle-replacement';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import {
  createScopedNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { Permissions } from '@/lib/permissions';
import { SystemRoles } from '@/lib/workspaces';

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

    // Replacement is already committed at this point. Notifications are a
    // best-effort operational side effect and must never roll back or disguise
    // the successful vehicle swap. A pending trip always requires the newly
    // allocated vehicle to pass its own official departure inspection.
    const db = getDb();
    const [trip] = await db
      .select({ id: trips.id, status: trips.status, vehicleId: trips.vehicleId })
      .from(trips)
      .where(and(eq(trips.allocationId, id), eq(trips.tenantId, auth.session.tenantId)))
      .limit(1)
      .catch(() => []);

    if (trip?.status === 'pending') {
      const recipients = await resolveActiveRoleRecipients(auth.session.tenantId, [
        SystemRoles.INSPECTOR,
        SystemRoles.RELEASE_OFFICER,
      ]).catch(() => []);

      if (recipients.length) {
        await createScopedNotifications({
          tenantId: auth.session.tenantId,
          recipientUserIds: recipients,
          category: 'action_required',
          eventType: 'replacement_departure_inspection_required',
          title: 'Replacement vehicle inspection required',
          body: 'The allocated vehicle was replaced before departure. The replacement vehicle requires a new official departure inspection before physical issue.',
          entityType: 'trip',
          entityId: trip.id,
          actionUrl: `/dashboard/inspections/new?type=departure&tripId=${trip.id}&vehicleId=${trip.vehicleId}`,
          workspace: null,
          priority: 'high',
        }).catch((error) =>
          console.warn('[Allocation Replace] Inspection notification failed:', error),
        );
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof VehicleReplaceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[Allocation Replace] POST failed:', error);
    return NextResponse.json({ error: 'Failed to replace vehicle' }, { status: 500 });
  }
}
