import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { maintenanceEvents, vehicleOdometerEvents, vehicles } from '@/db/schema/fleet';
import { auditEvents } from '@/db/schema/audit';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { createScopedNotifications } from '@/lib/notification-service';
import { WorkspaceIds } from '@/lib/workspaces';
import { runAtomicMutations } from '@/lib/db-atomic';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { vehicleScopeCondition } from '@/lib/record-scope';
import {
  validateMaintenanceServiceDate,
  validateNextServiceOdometer,
} from '@/lib/maintenance-record-validation';
import {
  parseOptionalIsoDate,
  VehicleInputValidationError,
} from '@/lib/vehicle-input-validation';

const SERVICE_TYPES = new Set(['scheduled', 'repair', 'inspection']);
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function optionalNonNegativeNumber(value: unknown, label: string) {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${label} must be a non-negative number`);
  return parsed;
}

function optionalNonNegativeInteger(value: unknown, label: string) {
  const parsed = optionalNonNegativeNumber(value, label);
  if (parsed === null) return null;
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be a non-negative whole number`);
  return parsed;
}

function postgresErrorDetails(error: unknown) {
  if (!error || typeof error !== 'object') {
    return { code: null as string | null, message: String(error || '') };
  }
  const record = error as {
    code?: unknown;
    message?: unknown;
    cause?: { code?: unknown; message?: unknown };
  };
  const code = typeof record.code === 'string'
    ? record.code
    : typeof record.cause?.code === 'string'
      ? record.cause.code
      : null;
  const message = [
    typeof record.message === 'string' ? record.message : '',
    typeof record.cause?.message === 'string' ? record.cause.message : '',
    String(error),
  ].filter(Boolean).join(' ');
  return { code, message };
}

/**
 * POST /api/maintenance
 * Record a maintenance-history event for a vehicle already within the active
 * Maintenance workspace's vehicle scope.
 *
 * A history row is not itself a vehicle safety decision. Vehicle blocking is
 * controlled by unresolved blocking defects / explicit fleet state changes,
 * so recording service history must never strand a vehicle in `maintenance`.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const roleCheck = await requireDashboardAction(session, '/dashboard/maintenance/new', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;
    const permCheck = await requirePermission(session, Permissions.MAINTENANCE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const vehicleId = typeof body.vehicleId === 'string' ? body.vehicleId : '';
    const serviceDateInput = typeof body.serviceDate === 'string' ? body.serviceDate : '';
    const serviceType = typeof body.serviceType === 'string' ? body.serviceType : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const vendorName = typeof body.vendorName === 'string' ? body.vendorName.trim() : '';
    const notes = typeof body.notes === 'string' ? body.notes.trim() : '';

    if (!vehicleId) return NextResponse.json({ error: 'Vehicle ID is required' }, { status: 400 });
    if (!serviceDateInput) {
      return NextResponse.json({ error: 'A valid service date is required' }, { status: 400 });
    }

    const serviceDate = parseOptionalIsoDate(serviceDateInput, 'Service date');
    if (!serviceDate) {
      return NextResponse.json({ error: 'A valid service date is required' }, { status: 400 });
    }
    const nextServiceDate = parseOptionalIsoDate(body.nextServiceDate, 'Next service date');

    const serviceDateError = validateMaintenanceServiceDate(serviceDate);
    if (serviceDateError) {
      return NextResponse.json({ error: serviceDateError }, { status: 400 });
    }
    if (!SERVICE_TYPES.has(serviceType)) {
      return NextResponse.json({ error: 'Service type must be scheduled, repair, or inspection' }, { status: 400 });
    }
    if (!description) return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    if (nextServiceDate && nextServiceDate < serviceDate) {
      return NextResponse.json({ error: 'Next service date cannot be before the service date' }, { status: 400 });
    }

    let serviceOdometer: number | null;
    let nextServiceOdometer: number | null;
    let cost: number | null;
    try {
      serviceOdometer = optionalNonNegativeInteger(body.serviceOdometer, 'Service odometer');
      nextServiceOdometer = optionalNonNegativeInteger(body.nextServiceOdometer, 'Next service odometer');
      cost = optionalNonNegativeNumber(body.cost, 'Cost');
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'Invalid numeric value' }, { status: 400 });
    }

    if (!UUID_PATTERN.test(vehicleId)) {
      return NextResponse.json(
        { error: 'Vehicle is not available in your current maintenance scope' },
        { status: 404 },
      );
    }

    const db = getDb();
    const roleNames = await getSessionRoleNames(session);
    const fleetAccess = resolveDashboardAccess('/dashboard/fleet', roleNames);
    const [vehicle] = await db
      .select({ id: vehicles.id, currentOdometer: vehicles.currentOdometer })
      .from(vehicles)
      .where(and(
        eq(vehicles.id, vehicleId),
        vehicleScopeCondition({
          tenantId: session.tenantId,
          userId: session.user.id,
          recordScope: fleetAccess.recordScope ?? 'related',
        }),
      ))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle is not available in your current maintenance scope' }, { status: 404 });
    }
    if (serviceOdometer !== null && serviceOdometer < vehicle.currentOdometer) {
      return NextResponse.json({ error: `Service odometer cannot be below the current vehicle odometer (${vehicle.currentOdometer} km)` }, { status: 409 });
    }
    const nextServiceOdometerError = validateNextServiceOdometer({
      nextServiceOdometer,
      serviceOdometer,
      currentVehicleOdometer: vehicle.currentOdometer,
    });
    if (nextServiceOdometerError) {
      return NextResponse.json({ error: nextServiceOdometerError }, { status: 400 });
    }

    const eventId = randomUUID();
    const odometerEventId = serviceOdometer !== null ? randomUUID() : null;
    const now = new Date();

    await runAtomicMutations((tx) => {
      const queries: any[] = [
        tx.insert(maintenanceEvents).values({
          id: eventId,
          vehicleId,
          serviceDate,
          serviceOdometer,
          serviceType,
          description,
          cost: cost !== null ? String(cost) : null,
          vendorName: vendorName || null,
          notes: notes || null,
          nextServiceDate,
          nextServiceOdometer,
          createdByUserId: session.user.id,
          assignedToUserId: session.user.id,
          createdAt: now,
          updatedAt: now,
        }),
      ];

      if (serviceOdometer !== null && odometerEventId) {
        queries.push(tx.insert(vehicleOdometerEvents).values({
          id: odometerEventId,
          vehicleId,
          odometerValue: serviceOdometer,
          source: 'maintenance',
          sourceEntityType: 'maintenance',
          sourceEntityId: eventId,
          recordedByUserId: session.user.id,
          notes: description,
        }));
        queries.push(tx.update(vehicles)
          .set({
            currentOdometer: sql`greatest(${vehicles.currentOdometer}, ${serviceOdometer})`,
            updatedAt: now,
            updatedBy: session.user.id,
          })
          .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, session.tenantId))));
      }

      queries.push(tx.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'maintenance_created',
        actorUserId: session.user.id,
        action: 'create',
        entityType: 'maintenance_event',
        entityId: eventId,
        correlationId: eventId,
        sourceChannel: 'web',
        summary: `Maintenance history: ${serviceType} — ${description}`,
        after: {
          vehicleId,
          serviceDate,
          serviceOdometer,
          serviceType,
          cost,
          vendorName: vendorName || null,
          nextServiceDate,
          nextServiceOdometer,
        },
      }));
      return queries;
    });

    try {
      await createScopedNotifications({
        tenantId: session.tenantId,
        recipientUserIds: [session.user.id],
        category: 'outcome',
        eventType: 'maintenance_event_created',
        title: `Maintenance Record Created — ${serviceType}`,
        body: `${description}${cost !== null ? ` — N$${cost.toFixed(2)}` : ''}${vendorName ? ` at ${vendorName}` : ''}.`,
        entityType: 'maintenance_event',
        entityId: eventId,
        actionUrl: '/dashboard/maintenance',
        workspace: WorkspaceIds.MAINTENANCE,
        priority: 'normal',
      });
    } catch (error) {
      console.error('[maintenance] Notification failed after commit:', error);
    }

    const [event] = await db.select().from(maintenanceEvents).where(eq(maintenanceEvents.id, eventId)).limit(1);
    return NextResponse.json({ data: event }, { status: 201 });
  } catch (error) {
    if (error instanceof VehicleInputValidationError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    const { code, message } = postgresErrorDetails(error);
    if (code === '23514' && message.includes('vehicle_odometer_regression')) {
      return NextResponse.json(
        {
          error:
            'The vehicle odometer advanced while this maintenance record was being saved. Refresh the vehicle and enter a reading at or above the latest recorded odometer.',
        },
        { status: 409 },
      );
    }
    console.error('[maintenance] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create maintenance event' }, { status: 500 });
  }
}
