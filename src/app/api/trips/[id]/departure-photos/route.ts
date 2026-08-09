/**
 * Departure Photos API
 * GET /api/trips/[id]/departure-photos — scoped comparison evidence for return inspection.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { inspectionPhotos, trips, vehicleInspections } from '@/db/schema/trips';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { resolveDashboardAccess, SystemRoles } from '@/lib/dashboard-access';
import { tripScopeCondition } from '@/lib/record-scope';
import { getSignedFileUrl, isStorageConfigured } from '@/lib/storage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid trip identifier' }, { status: 400 });
    }

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const routeCheck = await requireDashboardAction(session, '/dashboard/inspections', 'view');
    if (routeCheck instanceof NextResponse) return routeCheck;
    const permission = await requirePermission(session, Permissions.INSPECTION_VIEW);
    if (permission instanceof NextResponse) return permission;

    const db = getDb();
    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/inspections', roleNames);

    // Drivers may only obtain signed evidence for their own assigned trips.
    // Inspector/Transport/Audit workspaces have already been gated by the
    // canonical inspection route and INSPECTION_VIEW permission above.
    if (roleNames.includes(SystemRoles.DRIVER) || access.recordScope === 'self') {
      const [allowedTrip] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(
          and(
            eq(trips.id, id),
            tripScopeCondition({
              tenantId: session.tenantId,
              userId: session.user.id,
              recordScope: 'assigned',
            }),
          ),
        )
        .limit(1);
      if (!allowedTrip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    } else {
      const [tenantTrip] = await db
        .select({ id: trips.id })
        .from(trips)
        .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
        .limit(1);
      if (!tenantTrip) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
    }

    const inspections = await db
      .select({
        id: vehicleInspections.id,
        odometerReading: vehicleInspections.odometerReading,
        fuelLevel: vehicleInspections.fuelLevel,
        status: vehicleInspections.status,
        overallPass: vehicleInspections.overallPass,
        createdAt: vehicleInspections.createdAt,
        inspectorUserId: vehicleInspections.inspectorUserId,
      })
      .from(vehicleInspections)
      .where(
        and(
          eq(vehicleInspections.tripId, id),
          eq(vehicleInspections.type, 'departure'),
          eq(vehicleInspections.tenantId, session.tenantId),
        ),
      )
      .orderBy(desc(vehicleInspections.createdAt));

    if (inspections.length === 0) {
      return NextResponse.json({ inspections: [], photos: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const inspectionIds = inspections.map((inspection) => inspection.id);
    const photoRecords = await db
      .select({
        id: inspectionPhotos.id,
        inspectionId: inspectionPhotos.inspectionId,
        fileKey: inspectionPhotos.fileKey,
        caption: inspectionPhotos.caption,
        stage: inspectionPhotos.stage,
        capturedAt: inspectionPhotos.capturedAt,
      })
      .from(inspectionPhotos)
      .where(
        and(
          eq(inspectionPhotos.stage, 'departure'),
          inArray(inspectionPhotos.inspectionId, inspectionIds),
        ),
      )
      .orderBy(inspectionPhotos.capturedAt);

    const storageAvailable = isStorageConfigured();
    const photos = await Promise.all(
      photoRecords.map(async (photo) => {
        let signedUrl: string | null = null;
        if (storageAvailable && photo.fileKey) {
          try {
            signedUrl = await getSignedFileUrl(photo.fileKey, 3600);
          } catch {
            // Evidence metadata remains viewable if storage signing is temporarily unavailable.
          }
        }
        return { ...photo, signedUrl };
      }),
    );

    return NextResponse.json(
      { inspections, photos },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[departure-photos] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch departure photos' }, { status: 500 });
  }
}
