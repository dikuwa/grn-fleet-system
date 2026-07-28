import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { trips, tripAuthorities, vehicleInspections, inspectionItemResults, inspectionTemplates, inspectionTemplateItems, inspectionPhotos, vehicleAllocations } from '@/db/schema/trips';
import { vehicles, vehicleDefects, vehicleStatusEvents, maintenanceEvents, vehicleOdometerEvents } from '@/db/schema/fleet';
import { transportRequests } from '@/db/schema/requests';
import { auditEvents, notifications, roleAssignments, roles, tenantMemberships } from '@/db/schema';
import { getSessionRoleNames, requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { onInspectionCompleted } from '@/lib/document-generator';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { setAuthorityStatus } from '@/lib/trip-authority';
import { employees } from '@/db/schema/people';
import { SystemRoles } from '@/lib/dashboard-access';

export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/inspections/new', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.INSPECTION_PERFORM);
    if (permCheck instanceof NextResponse) return permCheck;

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
      photoKeys,
      inspectorAcknowledged,
      driverAcknowledged,
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
    if (!Array.isArray(checklist) || checklist.length === 0) return NextResponse.json({ error: 'The complete inspection checklist is required' }, { status: 400 });
    if (!inspectorAcknowledged || !driverAcknowledged) return NextResponse.json({ error: 'Inspector and driver acknowledgements are required' }, { status: 400 });

    const db = getDb();
    const userId = session.user.id;
    const tenantId = session.tenantId;

    // Verify the vehicle exists and belongs to this tenant
    const [vehicle] = await db
      .select({ id: vehicles.id, status: vehicles.status, currentOdometer: vehicles.currentOdometer })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found in your tenant' }, { status: 404 });
    }
    const submittedOdometer = Number(odometerReading);
    if (!Number.isInteger(submittedOdometer) || submittedOdometer < vehicle.currentOdometer) {
      return NextResponse.json({ error: `Odometer must be a whole number at or above ${vehicle.currentOdometer}` }, { status: 422 });
    }

    let trip: {
      id: string;
      status: string;
      vehicleId: string;
      requestStatus: string;
      driverEmployeeId: string | null;
      authorityId: string;
      authorityStatus: string;
    } | null = null;
    if (tripId) {
      const [foundTrip] = await db.select({
        id: trips.id,
        status: trips.status,
        vehicleId: trips.vehicleId,
        requestStatus: transportRequests.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
      }).from(trips)
        .innerJoin(transportRequests, eq(trips.requestId, transportRequests.id))
        .leftJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
        .where(and(eq(trips.id, tripId), eq(trips.tenantId, tenantId)))
        .limit(1);
      trip = foundTrip || null;
      if (!trip || trip.vehicleId !== vehicleId) return NextResponse.json({ error: 'Trip and vehicle do not match' }, { status: 404 });
      if (!trip.driverEmployeeId) return NextResponse.json({ error: 'A valid driver must be assigned before inspection' }, { status: 409 });
      const roleNames = await getSessionRoleNames(session);
      if (roleNames.includes(SystemRoles.DRIVER)) {
        const [employee] = await db
          .select({ id: employees.id })
          .from(employees)
          .where(and(eq(employees.tenantId, tenantId), eq(employees.userId, userId)))
          .limit(1);
        if (!employee || employee.id !== trip.driverEmployeeId) {
          return NextResponse.json({ error: 'Trip not found' }, { status: 404 });
        }
      }
      if (
        type === 'departure' &&
        (trip.status !== 'pending' ||
          !['authorised', 'ready_for_issue', 'approved', 'approved_emergency'].includes(trip.requestStatus))
      ) {
        return NextResponse.json({ error: 'Departure inspection requires final authorisation' }, { status: 409 });
      }
      if (
        type === 'departure' &&
        !['driver_accepted', 'awaiting_pre_trip_inspection'].includes(trip.authorityStatus)
      ) {
        return NextResponse.json({ error: 'The assigned driver must accept the Trip Authority before inspection' }, { status: 409 });
      }
      if (type === 'return' && !['in_progress', 'return_due', 'return_inspection'].includes(trip.status)) {
        return NextResponse.json({ error: 'Return inspection is only available after trip execution' }, { status: 409 });
      }
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

    // Use the active versioned template; client labels are mapped to server-owned item IDs.
    const [existingTemplate] = await db
      .select({ id: inspectionTemplates.id, version: inspectionTemplates.version })
      .from(inspectionTemplates)
      .where(
        and(
          eq(inspectionTemplates.tenantId, tenantId),
          eq(inspectionTemplates.type, type),
          eq(inspectionTemplates.isActive, true),
        ),
      )
      .limit(1);

    if (!existingTemplate) return NextResponse.json({ error: 'No active inspection template is configured' }, { status: 409 });
    const templateItems = await db.select().from(inspectionTemplateItems).where(eq(inspectionTemplateItems.templateId, existingTemplate.id));
    if (templateItems.length === 0) return NextResponse.json({ error: 'The active inspection template has no checklist items' }, { status: 409 });
    const submittedByLabel = new Map(checklist.map((item: { label?: string }) => [item.label, item]));
    if (submittedByLabel.size !== templateItems.length || templateItems.some((item) => !submittedByLabel.has(item.label))) {
      return NextResponse.json({ error: 'Submit every item from the active inspection template exactly once' }, { status: 422 });
    }
    const evaluatedItems = templateItems.map((templateItem) => {
      const submitted = submittedByLabel.get(templateItem.label) as { result: string; comment?: string };
      return { ...templateItem, result: submitted.result === 'na' ? 'not_applicable' : submitted.result, comment: submitted.comment };
    });
    if (evaluatedItems.some((item) => !['pass', 'fail', 'not_applicable'].includes(item.result))) {
      return NextResponse.json({ error: 'Inspection results must be pass, fail, or not applicable' }, { status: 422 });
    }
    if (evaluatedItems.some((item) => item.result === 'fail' && !item.comment?.trim())) {
      return NextResponse.json({ error: 'A comment is required for every failed item' }, { status: 422 });
    }
    const requiredPhotoCount = evaluatedItems.filter((item) => item.requiresPhoto).length;
    if (!Array.isArray(photoKeys) || photoKeys.length < requiredPhotoCount) {
      return NextResponse.json({ error: `At least ${requiredPhotoCount} inspection photos are required` }, { status: 422 });
    }
    const criticalPass = evaluatedItems.every((item) => !item.isCritical || item.result !== 'fail');
    const allPassed = evaluatedItems.every((item) => item.result !== 'fail');

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
        templateId: existingTemplate.id,
        templateVersion: existingTemplate.version,
        odometerReading: submittedOdometer,
        fuelLevel: fuelLevel || null,
        inspectorUserId: userId,
        driverEmployeeId: trip?.driverEmployeeId || null,
        signatureInspector: `acknowledged:${userId}:${new Date().toISOString()}`,
        signatureDriver: trip?.driverEmployeeId
          ? `acknowledged:${trip.driverEmployeeId}:${new Date().toISOString()}`
          : null,
        status,
        overallPass,
        notes: notes || null,
      })
      .returning();

    // Insert checklist results if provided
    const insertedItemIds: string[] = [];
    if (checklist?.length > 0) {
      const resultsToInsert = evaluatedItems.map((item) => {
        return ({
        inspectionId: inspection.id,
        templateItemId: item.id,
        result: item.result,
        comment: item.comment || null,
      });
      });

      const inserted = await db.insert(inspectionItemResults).values(resultsToInsert).returning();
      insertedItemIds.push(...inserted.map((r) => r.id));
    }

    // Create vehicle defects for failed inspection items
    const failedItems = evaluatedItems.filter((item) => item.result === 'fail');
    if (failedItems.length > 0) {
      const defectValues = failedItems.map((item) => ({
        vehicleId,
        tripId: tripId || null,
        inspectionId: inspection.id,
        severity: item.isCritical ? 'critical' : 'major',
        description: item.comment?.trim() || `Inspection item failed: ${item.label}`,
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

      if (failedItems.some((item) => item.isCritical)) {
        await db.update(vehicles).set({ status: 'maintenance', updatedAt: new Date() }).where(eq(vehicles.id, vehicleId));
        await db.insert(maintenanceEvents).values({
          vehicleId,
          serviceDate: new Date().toISOString().slice(0, 10),
          serviceOdometer: Number(odometerReading),
          serviceType: 'inspection',
          description: `Critical ${type} inspection defect follow-up`,
          notes: `Automatically escalated from inspection ${inspection.id}`,
          createdByUserId: userId,
        });
        await db.insert(vehicleStatusEvents).values({ vehicleId, previousStatus: vehicle.status, newStatus: 'maintenance', reason: `Critical defect in ${type} inspection`, changedByUserId: userId, referenceEntityType: 'inspection', referenceEntityId: inspection.id });
        const maintenanceUsers = await db.select({ userId: tenantMemberships.userId }).from(tenantMemberships)
          .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
          .innerJoin(roles, eq(roleAssignments.roleId, roles.id))
          .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, 'active'), eq(roles.name, 'Maintenance Officer')));
        if (maintenanceUsers.length) await db.insert(notifications).values(maintenanceUsers.map(({ userId: recipientUserId }) => ({ tenantId, recipientUserId, type: 'critical_defect', title: 'Critical inspection defect', body: `Vehicle requires maintenance follow-up after its ${type} inspection.`, entityType: 'inspection', entityId: inspection.id, actionUrl: '/dashboard/maintenance', priority: 'urgent' })));
      }
    }

    // Advance trip status based on inspection type (only if inspection passed)
    let updatedTrip = null;
    if (tripId && type === 'departure' && trip) {
      let authorityStatus = trip.authorityStatus;
      if (authorityStatus === 'driver_accepted') {
        await setAuthorityStatus({
          authorityId: trip.authorityId,
          tenantId,
          next: 'awaiting_pre_trip_inspection',
        });
        authorityStatus = 'awaiting_pre_trip_inspection';
      }
      if (overallPass && authorityStatus === 'awaiting_pre_trip_inspection') {
        await setAuthorityStatus({
          authorityId: trip.authorityId,
          tenantId,
          next: 'ready_for_departure',
          patch: { beginningOdometer: submittedOdometer },
        });
      }
    }
    if (tripId && type === 'return') {
      [updatedTrip] = await db.update(trips).set({ status: 'closure_review', returnedAt: new Date(), updatedAt: new Date() }).where(eq(trips.id, tripId)).returning();
      if (trip?.authorityStatus === 'awaiting_arrival_inspection') {
        await setAuthorityStatus({
          authorityId: trip.authorityId,
          tenantId,
          next: 'awaiting_reconciliation',
          patch: { endingOdometer: submittedOdometer },
        });
      }
    }

    // Link uploaded photos if provided
    if (photoKeys && Array.isArray(photoKeys) && photoKeys.length > 0) {
      const photoValues = photoKeys.map((key: string) => ({
        inspectionId: inspection.id,
        fileKey: key,
        stage: type,
      }));
      await db.insert(inspectionPhotos).values(photoValues);
    }

    await db.insert(vehicleOdometerEvents).values({ vehicleId, odometerValue: submittedOdometer, source: 'inspection', sourceEntityType: 'inspection', sourceEntityId: inspection.id, recordedByUserId: userId });
    await db.update(vehicles).set({ currentOdometer: submittedOdometer, updatedAt: new Date() }).where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)));
    await db.insert(auditEvents).values({ tenantId, tenantSequence: Date.now(), eventType: 'inspection_completed', actorUserId: userId, action: 'complete', entityType: 'inspection', entityId: inspection.id, summary: `${type} inspection ${status}; ${failedItems.length} defect(s) recorded`, after: { tripId, vehicleId, overallPass, criticalDefects: failedItems.filter((item) => item.isCritical).length }, sourceChannel: 'web' });

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
