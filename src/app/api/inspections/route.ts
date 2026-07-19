import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, vehicleInspections, inspectionItemResults, inspectionTemplates, tripClosures } from '@/db/schema/trips';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onInspectionCompleted } from '@/lib/document-generator';
import { eq, and, isNull, sql } from 'drizzle-orm';

export async function POST(req: NextRequest) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: any = await req.json();
    const {
      vehicleId,
      tripId,
      type,
      odometerReading,
      fuelLevel,
      checklist, // Array of { templateItemId, result, comment }
      notes,
    } = body;

    // Validate required fields
    if (!vehicleId) {
      return NextResponse.json({ error: 'Vehicle ID is required' }, { status: 400 });
    }
    if (!type || !['departure', 'return'].includes(type)) {
      return NextResponse.json({ error: 'Inspection type must be departure or return' }, { status: 400 });
    }
    if (!odometerReading) {
      return NextResponse.json({ error: 'Odometer reading is required' }, { status: 400 });
    }

    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Require inspection permission
    const permCheck = await requirePermission(session, Permissions.INSPECTION_PERFORM);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    // Verify the vehicle exists and belongs to this tenant
    const [vehicle] = await db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found in your tenant' }, { status: 404 });
    }

    // Block departure if vehicle has unresolved critical/blocking defects
    if (type === 'departure') {
      const [blockingDefect] = await db
        .select({ count: sql<number>`count(*)` })
        .from(vehicleDefects)
        .where(
          and(
            eq(vehicleDefects.vehicleId, vehicleId),
            isNull(vehicleDefects.resolvedAt),
            eq(vehicleDefects.isBlocking, true),
          ),
        );

      if (blockingDefect && Number(blockingDefect.count) > 0) {
        return NextResponse.json(
          {
            error: 'Departure inspection blocked: This vehicle has unresolved critical or blocking defects. Resolve all defects before departure.',
            blockingDefects: Number(blockingDefect.count),
          },
          { status: 409 },
        );
      }
    }

    const items: Array<{ result: string; isCritical?: boolean }> = checklist || [];
    const criticalPass = items.length === 0 ||
      items.every(
        (item) => !item.isCritical || item.result === 'pass' || item.result === 'na' || item.result === 'not_applicable',
      );
    const allPassed = items.length === 0 ||
      items.every(
        (item) => item.result === 'pass' || item.result === 'na' || item.result === 'not_applicable',
      );

    // Find or create a default inspection template to satisfy the FK constraint
    let templateId: string;
    const [existingTemplate] = await db
      .select({ id: inspectionTemplates.id })
      .from(inspectionTemplates)
      .where(
        and(
          eq(inspectionTemplates.tenantId, tenantId),
          eq(inspectionTemplates.type, type),
          eq(inspectionTemplates.isActive, true),
        ),
      )
      .limit(1);

    if (existingTemplate) {
      templateId = existingTemplate.id;
    } else {
      // Create a default template
      const [newTemplate] = await db
        .insert(inspectionTemplates)
        .values({
          tenantId,
          name: type === 'departure' ? 'Default Departure Inspection' : 'Default Return Inspection',
          type,
          version: 1,
          isActive: true,
        })
        .returning();
      templateId = newTemplate.id;
    }

    const overallPass = allPassed;
    const status = criticalPass ? 'completed' : 'failed';

    // Create the inspection
    const [inspection] = await db
      .insert(vehicleInspections)
      .values({
        tenantId,
        vehicleId,
        tripId: tripId || null,
        type,
        templateId,
        templateVersion: 1,
        odometerReading: Number(odometerReading),
        fuelLevel: fuelLevel || null,
        inspectorUserId: userId,
        status,
        overallPass,
        notes: notes || null,
      })
      .returning();

    // Insert checklist results if provided
    const insertedItemIds: string[] = [];
    if (checklist?.length > 0) {
      const resultsToInsert = checklist.map((item: { templateItemId?: string; label?: string; result: string; comment?: string; isCritical?: boolean }) => ({
        inspectionId: inspection.id,
        templateItemId: item.templateItemId || '00000000-0000-0000-0000-000000000000',
        result: item.result === 'na' ? 'not_applicable' : item.result,
        comment: item.comment || null,
      }));

      const inserted = await db.insert(inspectionItemResults).values(resultsToInsert).returning();
      insertedItemIds.push(...inserted.map((r) => r.id));
    }

    // Create vehicle defects for failed inspection items
    const failedItems = (checklist || []).filter(
      (item: { result: string }) => item.result === 'fail',
    );
    if (failedItems.length > 0) {
      const defectValues = failedItems.map((item: { templateItemId?: string; label?: string; comment?: string; isCritical?: boolean }) => ({
        vehicleId,
        tripId: tripId || null,
        inspectionId: inspection.id,
        severity: item.isCritical ? 'critical' : 'major',
        description: item.label || `Inspection item failed: ${item.templateItemId || 'unknown'}`,
        isBlocking: item.isCritical === true,
        reportedByUserId: userId,
      }));

      try {
        await db.insert(vehicleDefects).values(defectValues);
        console.log(`[Inspections] Created ${defectValues.length} defect(s) from ${type} inspection ${inspection.id}`);
      } catch (err) {
        console.error('[Inspections] Failed to create defects:', err);
        // Non-fatal — inspection already saved
      }
    }

    // Advance trip status based on inspection type (only if inspection passed)
    let updatedTrip = null;
    if (tripId && overallPass) {
      // Auto-close: if ALL items pass (no fails at all), skip closure_review
      const anyFails = items.some((item) => item.result === 'fail');
      const useAutoClose = type === 'return' && !anyFails;

      const tripStatusUpdate: Record<string, { status: string; timestamp: string }> = {
        departure: { status: 'in_progress', timestamp: 'startedAt' },
        return: { status: useAutoClose ? 'closed' : 'closure_review', timestamp: 'returnedAt' },
      };

      const update = tripStatusUpdate[type];
      if (update) {
        const updateData: Record<string, unknown> = {
          status: update.status,
          updatedAt: new Date(),
        };
        if (update.timestamp === 'startedAt') updateData.startedAt = new Date();
        if (update.timestamp === 'returnedAt') updateData.returnedAt = new Date();
        if (useAutoClose) updateData.closedAt = new Date();

        [updatedTrip] = await db
          .update(trips)
          .set(updateData)
          .where(eq(trips.id, tripId))
          .returning();
      }

      // If auto-closing, also create a trip closure record
      if (useAutoClose) {
        await db.insert(tripClosures).values({
          tripId,
          closedByUserId: userId,
          decision: 'closed',
        }).onConflictDoNothing();

        // Trigger document generation for trip closure
        try {
          const { onTripClosed } = await import('@/lib/document-generator');
          await onTripClosed(tripId, tenantId, userId);
        } catch { /* silent — doc gen is best-effort */ }
      }
    }

    // Trigger document generation
    const doc = await onInspectionCompleted(inspection.id, tenantId, userId);

    return NextResponse.json({ inspection, trip: updatedTrip, document: doc, overallPass, status });
  } catch (error) {
    console.error('[inspections] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to complete inspection' },
      { status: 500 },
    );
  }
}
