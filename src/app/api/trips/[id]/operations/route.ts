import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  tripAuthorities,
  tripExpenses,
  tripIncidents,
  tripProgressEntries,
  trips,
  vehicleAllocations,
} from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import {
  auditEvents,
  notifications,
  roleAssignments,
  rolePermissions,
  tenantMemberships,
} from '@/db/schema';
import { hasPermission, requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { setAuthorityStatus } from '@/lib/trip-authority';

const progressTypes = [
  'official_stop',
  'passenger_pickup',
  'passenger_drop_off',
  'fuel_stop',
  'overnight_stop',
  'breakdown',
  'border_point',
  'destination_reached',
  'return_departure',
  'arrival',
  'route_deviation',
] as const;
const expenseCategories = ['petrol', 'diesel', 'oil', 'toll', 'parking', 'accommodation', 'repairs', 'emergency_parts', 'other'];
const incidentTypes = ['accident', 'breakdown', 'tyre_damage', 'theft', 'fuel_card_issue', 'passenger_emergency', 'road_closure', 'traffic_offence', 'vehicle_defect', 'other'];

async function notifyTransportAdministrators(
  tenantId: string,
  values: Omit<typeof notifications.$inferInsert, 'tenantId' | 'recipientUserId'>,
) {
  const db = getDb();
  const recipients = await db
    .selectDistinct({ userId: tenantMemberships.userId })
    .from(tenantMemberships)
    .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
    .innerJoin(rolePermissions, eq(rolePermissions.roleId, roleAssignments.roleId))
    .where(and(
      eq(tenantMemberships.tenantId, tenantId),
      eq(tenantMemberships.status, 'active'),
      eq(rolePermissions.permissionCode, Permissions.TRIP_MANAGE),
    ));
  if (recipients.length) {
    await db.insert(notifications).values(recipients.map(({ userId }) => ({
      ...values,
      tenantId,
      recipientUserId: userId,
    })));
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/trips', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const { id } = await params;
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || '');
    const db = getDb();

    const [employee] = await db.select({ id: employees.id }).from(employees)
      .where(and(eq(employees.userId, session.user.id), eq(employees.tenantId, session.tenantId)))
      .limit(1);
    const [context] = await db
      .select({
        tripStatus: trips.status,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        authorityId: tripAuthorities.id,
        authorityStatus: tripAuthorities.status,
        beginningOdometer: tripAuthorities.beginningOdometer,
        endingOdometer: tripAuthorities.endingOdometer,
      })
      .from(trips)
      .innerJoin(vehicleAllocations, eq(vehicleAllocations.id, trips.allocationId))
      .innerJoin(tripAuthorities, eq(tripAuthorities.tripId, trips.id))
      .where(and(eq(trips.id, id), eq(trips.tenantId, session.tenantId)))
      .limit(1);
    if (!context) return NextResponse.json({ error: 'Trip not found' }, { status: 404 });

    const canManage = await hasPermission(session, Permissions.TRIP_MANAGE);
    if (!canManage && (!employee || employee.id !== context.driverEmployeeId)) {
      return NextResponse.json({ error: 'Only the assigned driver or Transport Administrator may update this trip' }, { status: 403 });
    }
    if (!['in_progress', 'return_due', 'closure_review'].includes(context.tripStatus)) {
      return NextResponse.json({ error: `Trip updates are unavailable while status is "${context.tripStatus}"` }, { status: 409 });
    }

    const clientSyncId = typeof body.clientSyncId === 'string' ? body.clientSyncId : null;
    const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : new Date();
    if (Number.isNaN(occurredAt.getTime())) {
      return NextResponse.json({ error: 'A valid occurrence date and time is required' }, { status: 422 });
    }

    if (action === 'progress') {
      const entryType = String(body.entryType || '');
      if (!progressTypes.includes(entryType as (typeof progressTypes)[number])) {
        return NextResponse.json({ error: 'Select a valid progress or stop type' }, { status: 422 });
      }
      const odometer = body.odometerReading === null || body.odometerReading === undefined
        ? null
        : Number(body.odometerReading);
      const [previous] = await db.select({ value: tripProgressEntries.odometerReading })
        .from(tripProgressEntries)
        .where(and(eq(tripProgressEntries.tripId, id), isNotNull(tripProgressEntries.odometerReading)))
        .orderBy(desc(tripProgressEntries.occurredAt))
        .limit(1);
      const floor = previous?.value ?? context.beginningOdometer ?? 0;
      if (odometer !== null && (!Number.isInteger(odometer) || odometer < floor)) {
        return NextResponse.json({ error: `Odometer must be a whole number at or above ${floor}` }, { status: 422 });
      }
      if (entryType === 'route_deviation' && !String(body.routeDeviationReason || '').trim()) {
        return NextResponse.json({ error: 'A route deviation reason is required' }, { status: 422 });
      }
      const [entry] = await db.insert(tripProgressEntries).values({
        tenantId: session.tenantId,
        tripId: id,
        clientSyncId,
        entryType,
        occurredAt,
        location: body.location ? String(body.location) : null,
        latitude: body.latitude !== undefined ? String(body.latitude) : null,
        longitude: body.longitude !== undefined ? String(body.longitude) : null,
        odometerReading: odometer,
        note: body.note ? String(body.note) : null,
        routeDeviationReason: body.routeDeviationReason ? String(body.routeDeviationReason) : null,
        priorApprovalObtained: typeof body.priorApprovalObtained === 'boolean' ? body.priorApprovalObtained : null,
        attachmentKey: body.attachmentKey ? String(body.attachmentKey) : null,
        createdByUserId: session.user.id,
        offlineCreatedAt: body.offlineCreatedAt ? new Date(String(body.offlineCreatedAt)) : null,
      }).onConflictDoNothing().returning();
      if (!entry && clientSyncId) {
        const [existing] = await db.select().from(tripProgressEntries)
          .where(and(eq(tripProgressEntries.tenantId, session.tenantId), eq(tripProgressEntries.clientSyncId, clientSyncId)))
          .limit(1);
        return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
      }
      if (entryType === 'route_deviation' && context.authorityStatus === 'in_progress') {
        await setAuthorityStatus({
          authorityId: context.authorityId,
          tenantId: session.tenantId,
          next: 'route_deviation_pending_review',
        });
        await notifyTransportAdministrators(session.tenantId, {
          type: 'route_deviation',
          title: 'Route deviation requires review',
          body: String(body.routeDeviationReason),
          entityType: 'trip',
          entityId: id,
          actionUrl: `/dashboard/trips/${id}`,
          priority: body.priorApprovalObtained ? 'high' : 'emergency',
        });
      }
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: entryType === 'route_deviation' ? 'route_deviation_recorded' : 'trip_progress_recorded',
        actorUserId: session.user.id,
        actorEmployeeId: employee?.id,
        action: 'create',
        entityType: 'trip_progress',
        entityId: entry.id,
        summary: `${entryType.replaceAll('_', ' ')} recorded`,
        after: { tripId: id, odometer, location: body.location },
        sourceChannel: clientSyncId ? 'offline_sync' : 'web',
      });
      return NextResponse.json({ success: true, data: entry }, { status: 201 });
    }

    if (action === 'expense') {
      const category = String(body.category || '');
      const amount = Number(body.amount);
      if (!expenseCategories.includes(category) || !Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json({ error: 'A valid category and positive amount are required' }, { status: 422 });
      }
      const [expense] = await db.insert(tripExpenses).values({
        tenantId: session.tenantId,
        tripId: id,
        clientSyncId,
        category,
        supplier: body.supplier ? String(body.supplier) : null,
        transactionAt: occurredAt,
        referenceNumber: body.referenceNumber ? String(body.referenceNumber) : null,
        amount: amount.toFixed(2),
        currency: body.currency ? String(body.currency).toUpperCase() : 'NAD',
        odometerReading: body.odometerReading ? Number(body.odometerReading) : null,
        receiptKey: body.receiptKey ? String(body.receiptKey) : null,
        notes: body.note ? String(body.note) : null,
        enteredByUserId: session.user.id,
      }).onConflictDoNothing().returning();
      if (!expense && clientSyncId) {
        const [existing] = await db.select().from(tripExpenses)
          .where(and(eq(tripExpenses.tenantId, session.tenantId), eq(tripExpenses.clientSyncId, clientSyncId)))
          .limit(1);
        return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
      }
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_expense_created',
        actorUserId: session.user.id,
        actorEmployeeId: employee?.id,
        action: 'create',
        entityType: 'trip_expense',
        entityId: expense.id,
        summary: `${category.replaceAll('_', ' ')} expense recorded — ${expense.currency} ${expense.amount}`,
        sourceChannel: clientSyncId ? 'offline_sync' : 'web',
      });
      return NextResponse.json({ success: true, data: expense }, { status: 201 });
    }

    if (action === 'incident') {
      const incidentType = String(body.incidentType || '');
      const description = String(body.description || '').trim();
      if (!incidentTypes.includes(incidentType) || description.length < 10) {
        return NextResponse.json({ error: 'Select an incident type and provide a useful description' }, { status: 422 });
      }
      const safeToContinue = body.safeToContinue === true;
      const [incident] = await db.insert(tripIncidents).values({
        tenantId: session.tenantId,
        tripId: id,
        clientSyncId,
        incidentType,
        occurredAt,
        location: body.location ? String(body.location) : null,
        odometerReading: body.odometerReading ? Number(body.odometerReading) : null,
        description,
        injuries: body.injuries === true,
        vehicleDamage: body.vehicleDamage === true,
        thirdPartyInvolvement: body.thirdPartyInvolvement === true,
        policeReference: body.policeReference ? String(body.policeReference) : null,
        emergencyServicesContacted: body.emergencyServicesContacted === true,
        safeToContinue,
        actionTaken: body.actionTaken ? String(body.actionTaken) : null,
        attachmentKeys: Array.isArray(body.attachmentKeys) ? body.attachmentKeys.map(String) : [],
        reportedByUserId: session.user.id,
        offlineCreatedAt: body.offlineCreatedAt ? new Date(String(body.offlineCreatedAt)) : null,
      }).onConflictDoNothing().returning();
      if (!incident && clientSyncId) {
        const [existing] = await db.select().from(tripIncidents)
          .where(and(eq(tripIncidents.tenantId, session.tenantId), eq(tripIncidents.clientSyncId, clientSyncId)))
          .limit(1);
        return NextResponse.json({ success: true, data: existing, idempotentReplay: true });
      }
      if (['in_progress', 'delayed', 'route_deviation_pending_review'].includes(context.authorityStatus)) {
        await setAuthorityStatus({
          authorityId: context.authorityId,
          tenantId: session.tenantId,
          next: 'incident_reported',
        });
      }
      await notifyTransportAdministrators(session.tenantId, {
        type: 'trip_incident',
        title: `${safeToContinue ? 'Incident' : 'Urgent incident'} reported`,
        body: description,
        entityType: 'trip',
        entityId: id,
        actionUrl: `/dashboard/trips/${id}`,
        priority: safeToContinue ? 'high' : 'emergency',
      });
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'trip_incident_reported',
        actorUserId: session.user.id,
        actorEmployeeId: employee?.id,
        action: 'report',
        entityType: 'trip_incident',
        entityId: incident.id,
        summary: `${incidentType.replaceAll('_', ' ')} incident reported`,
        after: { tripId: id, safeToContinue, injuries: body.injuries, vehicleDamage: body.vehicleDamage },
        sourceChannel: clientSyncId ? 'offline_sync' : 'web',
      });
      return NextResponse.json({ success: true, data: incident }, { status: 201 });
    }

    return NextResponse.json({ error: 'Unsupported operation' }, { status: 400 });
  } catch (error) {
    console.error('[trips/operations] POST failed:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to save trip operation',
    }, { status: 500 });
  }
}
