/**
 * Departure Photos API
 *
 * GET /api/trips/[id]/departure-photos — Fetch departure inspection photos for a trip
 * Used by the return inspection page to compare pre-departure vs return images.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  vehicleInspections,
  inspectionPhotos,
} from '@/db/schema/trips';
import { eq, and, desc } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { getSignedFileUrl, isStorageConfigured } from '@/lib/storage';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid trip identifier' }, { status: 400 });
    }

    const auth = await requireRequestAuth(_req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const tenantId = session.tenantId;

    // Find all departure inspections for this trip
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
          eq(vehicleInspections.tenantId, tenantId),
        ),
      )
      .orderBy(desc(vehicleInspections.createdAt));

    if (inspections.length === 0) {
      return NextResponse.json({ inspections: [], photos: [] });
    }

    // Fetch photos for all departure inspections
    const inspectionIds = inspections.map((i) => i.id);
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
          ...inspectionIds.map((iid) => eq(inspectionPhotos.inspectionId, iid)),
        ),
      )
      .orderBy(inspectionPhotos.capturedAt);

    // Generate signed URLs
    const storageAvailable = isStorageConfigured();
    const photos = await Promise.all(
      photoRecords.map(async (photo) => {
        let signedUrl: string | null = null;
        if (storageAvailable && photo.fileKey) {
          try {
            signedUrl = await getSignedFileUrl(photo.fileKey, 3600);
          } catch {
            // Best-effort
          }
        }
        return { ...photo, signedUrl };
      }),
    );

    return NextResponse.json({ inspections, photos });
  } catch (error) {
    console.error('[departure-photos] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to fetch departure photos' },
      { status: 500 },
    );
  }
}
