import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tripAuthorities, trips } from '@/db/schema/trips';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';
import { Permissions } from '@/lib/permissions';
import {
  completeOfficialInspection,
  InspectionServiceError,
} from '@/lib/inspection-service';
import { findPendingAuthorityAmendmentAcceptance } from '@/lib/trip-amendment-acceptance';
import { onTripIssued } from '@/lib/document-generator';
import {
  createScopedNotifications,
  resolveActionNotifications,
  resolveActiveRoleRecipients,
} from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

    const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';
    const tripId = typeof body.tripId === 'string' ? body.tripId : '';
    if (
      vehicleId &&
      tripId &&
      (!UUID_PATTERN.test(vehicleId) || !UUID_PATTERN.test(tripId))
    ) {
      return NextResponse.json({ error: 'Trip or vehicle not found' }, { status: 404 });
    }

    // Any driver-material authority amendment invalidates the previous
    // acceptance for departure. Keep the original acknowledgement immutable,
    // but require acceptance of the current authority before a fresh official
    // departure inspection can be submitted.
    if (body.type === 'departure' && tripId) {
      const db = getDb();
      const [authority] = await db
        .select({ id: tripAuthorities.id, acceptedAt: tripAuthorities.acceptedAt })
        .from(tripAuthorities)
        .where(
          and(
            eq(tripAuthorities.tripId, tripId),
            eq(tripAuthorities.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      if (authority) {
        const pendingAmendment = await findPendingAuthorityAmendmentAcceptance({
          authorityId: authority.id,
          acceptedAt: authority.acceptedAt,
        });
        if (pendingAmendment) {
          return NextResponse.json(
            {
              error:
                `A ${pendingAmendment.amendmentType.replaceAll('_', ' ')} amendment became effective after the driver accepted the Trip Authority. The revised authority must be acknowledged before departure inspection.`,
              amendmentId: pendingAmendment.amendmentId,
              amendmentType: pendingAmendment.amendmentType,
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
      vehicleId,
      tripId,
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

    // A passed departure inspection makes formal Trip Authority issuance the
    // next boundary. Refresh the still-draft authority snapshot now so its
    // preview contains the completed current-vehicle inspection. Physical
    // vehicle issue remains a separate later step and is still server-guarded
    // on the latest formally issued Trip Authority.
    if (
      body.type === 'departure' &&
      result.overallPass === true &&
      result.idempotent !== true &&
      tripId
    ) {
      const db = getDb();
      const [trip] = await db
        .select({ allocationId: trips.allocationId })
        .from(trips)
        .where(and(eq(trips.id, tripId), eq(trips.tenantId, session.tenantId)))
        .limit(1);
      if (trip?.allocationId) {
        await onTripIssued(trip.allocationId, session.tenantId, session.user.id).catch((error) =>
          console.warn('[inspections] Departure inspection committed but authority draft refresh failed:', error),
        );
      }

      await resolveActionNotifications({
        tenantId: session.tenantId,
        entityType: 'trip',
        entityId: tripId,
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
          eventType: 'trip_authority_issue_ready',
          title: 'Trip Authority ready for formal issue',
          body: 'The official departure inspection passed. Review and formally issue the latest Trip Authority before recording physical vehicle issue.',
          entityType: 'trip',
          entityId: tripId,
          actionUrl: `/dashboard/trips/${tripId}`,
          workspace: WorkspaceIds.TRANSPORT_ADMIN,
          priority: 'high',
        }).catch((error) =>
          console.warn('[inspections] Authority issue-ready notification failed:', error),
        );
      }
    }

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InspectionServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const { code, message } = getDatabaseErrorDetails(error);
    if (code === '23514' && message.includes('inspection_lifecycle_conflict')) {
      return NextResponse.json(
        {
          error:
            'This inspection is no longer current because the trip or Trip Authority lifecycle changed while it was being submitted. Refresh the trip and use the latest authority and inspection state.',
        },
        { status: 409 },
      );
    }
    if (code === '23514' && message.includes('inspection_evidence_claim_conflict')) {
      return NextResponse.json(
        {
          error:
            'One or more inspection photos are no longer valid for this submission. Re-upload the affected evidence and submit the inspection again.',
        },
        { status: 409 },
      );
    }
    if (code === '23514' && message.includes('vehicle_odometer_regression')) {
      return NextResponse.json(
        {
          error:
            'The vehicle odometer advanced while this inspection was being submitted. Refresh the inspection context and enter a reading at or above the latest vehicle odometer.',
        },
        { status: 409 },
      );
    }
    console.error('[inspections] POST failed:', error);
    return NextResponse.json({ error: 'Failed to complete inspection' }, { status: 500 });
  }
}
