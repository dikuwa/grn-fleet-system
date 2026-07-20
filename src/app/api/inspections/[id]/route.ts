import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleInspections, inspectionItemResults, inspectionTemplateItems, inspectionPhotos } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import { employees } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.INSPECTION_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    const [inspection] = await db
      .select({
        id: vehicleInspections.id,
        tenantId: vehicleInspections.tenantId,
        vehicleId: vehicleInspections.vehicleId,
        tripId: vehicleInspections.tripId,
        type: vehicleInspections.type,
        odometerReading: vehicleInspections.odometerReading,
        fuelLevel: vehicleInspections.fuelLevel,
        status: vehicleInspections.status,
        overallPass: vehicleInspections.overallPass,
        notes: vehicleInspections.notes,
        createdAt: vehicleInspections.createdAt,
        updatedAt: vehicleInspections.updatedAt,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
      })
      .from(vehicleInspections)
      .leftJoin(vehicles, eq(vehicleInspections.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicleInspections.id, id),
          eq(vehicleInspections.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!inspection) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 });
    }

    // Fetch checklist items
    const results = await db
      .select({
        id: inspectionItemResults.id,
        result: inspectionItemResults.result,
        comment: inspectionItemResults.comment,
        defectId: inspectionItemResults.defectId,
        templateItemId: inspectionTemplateItems.id,
        category: inspectionTemplateItems.category,
        label: inspectionTemplateItems.label,
        isCritical: inspectionTemplateItems.isCritical,
      })
      .from(inspectionItemResults)
      .leftJoin(
        inspectionTemplateItems,
        eq(inspectionItemResults.templateItemId, inspectionTemplateItems.id),
      )
      .where(eq(inspectionItemResults.inspectionId, id))
      .orderBy(inspectionTemplateItems.sortOrder);

    // Fetch photos
    const photos = await db
      .select({
        id: inspectionPhotos.id,
        fileKey: inspectionPhotos.fileKey,
        caption: inspectionPhotos.caption,
        capturedAt: inspectionPhotos.capturedAt,
      })
      .from(inspectionPhotos)
      .where(eq(inspectionPhotos.inspectionId, id))
      .orderBy(inspectionPhotos.capturedAt);

    return NextResponse.json({ inspection, results, photos });
  } catch (error) {
    console.error('[inspections/id] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to load inspection' },
      { status: 500 },
    );
  }
}
