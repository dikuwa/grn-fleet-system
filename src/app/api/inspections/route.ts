import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripAuthorities } from '@/db/schema/trips';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  completeOfficialInspection,
  InspectionServiceError,
} from '@/lib/inspection-service';
import { findPendingVehicleReplacementAcceptance } from '@/lib/trip-amendment-acceptance';
import {
  createScopedNotifications,
  resolveActionNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

function postgresErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { code?: unknown; cause?: unknown };
  if (typeof record.code === 'string') return record.code;
  if (record.cause && typeof record.cause === 'object') {
    const cause = record.cause as { code?: unknown };
    if (typeof cause.code === 'string') return cause.code;
  }
  return null;
}

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error || '');
  const record = error as { message?: unknown; cause?: unknown };
  const parts = [typeof record.message === 'string' ? record.message : ''];
  if (record.cause && typeof record.cause === 'object') {
    const cause = record.cause as { message?: unknown };
    if (typeof cause.message === 'string') parts.push(cause.message);
  }
  return parts.filter(Boolean).join(' ');
}

export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const checklist = Array.isArray(body.checklist) ? body.checklist : [];
    const assessedItems = checklist.filter(
      (item: { result?: unknown }) => item?.result === 'pass' || item?.result === 'fail',
    );
    if (checklist.length > 0 && assessedItems.length === 0) {
      return NextResponse.json(
        {
          error:
            'The inspection cannot be completed with every checklist item marked not applicable. Assess each applicable item as pass or fail.',
        },
        { status: 422 },
      );
    }

    // A vehicle replacement is a material change to the authority the driver
    // accepted. Preserve the original acknowledgement, but do not allow the
    // replacement vehicle's official departure inspection until the revised
    // authority has been acknowledged again.
    if (body.type === 'departure' && typeof body.tripId === 'string') {
      const db = getDb();
      const [authority] = await db
        .select({ id: tripAuthorities.id, acceptedAt: tripAuthorities.acceptedAt })
        .from(tripAuthorities)
        .where(
          and(
            eq(tripAuthorities.tripId, body.tripId),
            eq(tripAuthorities.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      if (authority) {
        const pendingAmendment = await findPendingVehicleReplacementAcceptance({
          authorityId: authority.id,
          acceptedAt: authority.acceptedAt,
        });
        if (pendingAmendment) {
          return NextResponse.json(
            {
              error:
                'The vehicle changed after the driver accepted the Trip Authority. The revised authority must be acknowledged before the replacement vehicle can be inspected for departure.',
              amendmentId: pendingAmendment.amendmentId,
              requiresAmendmentAcceptance: true,
            },
            { status: 409 },
          );
        }
      }
    }

    const result = await completeOfficialInspection({
      tenantId: session.tenantId,
      userId: session.user.id,
      vehicleId: body.vehicleId,
      tripId: body.tripId,
      type: body.type,
      odometerReading: Number(body.odometerReading),
      fuelLevel: body.fuelLevel,
      checklist,
      notes: body.notes,
      photoKeys: Array.isArray(body.photoKeys) ? body.photoKeys : [],
      inspectorAcknowledged: body.inspectorAcknowledged === true,
      driverAcknowledged: body.driverAcknowledged === true,
      clientSyncId: typeof body.clientSyncId === 'string' ? body.clientSyncId : null,
    });

    // A passed departure inspection closes the inspection officer's action and
    // hands the trip to Transport Administration for the separate physical
    // issue step. Keep failed inspections actionable because the vehicle must
    // be repaired/re-inspected before it can leave.
    if (
      body.type === 'departure' &&
      result.overallPass === true &&
      result.idempotent !== true &&
      typeof body.tripId === 'string'
    ) {
      await resolveActionNotifications({
        tenantId: session.tenantId,
        entityType: 'trip',
        entityId: body.tripId,
        eventTypes: ['departure_inspection_required'],
      }).catch((error) =>
        console.warn('[inspections] Could not resolve departure-inspection notification:', error),
      );

      const transportRecipients = await resolveActiveRoleRecipients(session.tenantId, [
        SystemRoles.TRANSPORT_ADMIN,
      ]).catch(() => []);
      if (transportRecipients.length) {
        await createScopedNotifications({
          tenantId: session.tenantId,
          recipientUserIds: transportRecipients,
          category: 'action_required',
          eventType: 'vehicle_issue_ready',
          title: 'Vehicle ready for physical issue',
          body: 'The official departure inspection passed. Confirm keys, issue odometer and any fuel card handover before departure.',
          entityType: 'trip',
          entityId: body.tripId,
          actionUrl: `/dashboard/trips/${body.tripId}`,
          workspace: WorkspaceIds.TRANSPORT_ADMIN,
          priority: 'high',
        }).catch((error) =>
          console.warn('[inspections] Transport issue-ready notification failed:', error),
        );
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InspectionServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const code = postgresErrorCode(error);
    const message = errorText(error);
    if (code === '23514' && message.includes('inspection_lifecycle_conflict')) {
      return NextResponse.json(
        {
          error:
            'This inspection is no longer current because the trip lifecycle changed while it was being submitted. Refresh the trip and use the latest inspection state.',
        },
        { status: 409 },
      );
    }
    console.error('[inspections] POST failed:', error);
    return NextResponse.json({ error: 'Failed to complete inspection' }, { status: 500 });
  }
}
