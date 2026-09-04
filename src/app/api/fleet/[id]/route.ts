import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  vehicleCategories,
  vehicleOdometerEvents,
  vehicleStatusEvents,
  vehicles,
} from '@/db/schema/fleet';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, ne, sql } from 'drizzle-orm';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { vehicleScopeCondition } from '@/lib/record-scope';
import { recordAuditEvent } from '@/lib/audit-event';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const MANUAL_EDIT_STATUSES = new Set(['available', 'provisional', 'maintenance']);
const PROTECTED_REACTIVATION_STATUSES = new Set(['maintenance', 'out_of_service', 'written_off']);
const VEHICLE_UPDATE_CONFLICT = 'vehicle_update_conflict';

/**
 * GET /api/fleet/[id]
 * Fetch a single vehicle by ID.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/fleet', 'view');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { id } = await params;
    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/fleet', roleNames);

    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(
        and(
          eq(vehicles.id, id),
          vehicleScopeCondition({
            tenantId: session.tenantId,
            userId: session.user.id,
            recordScope: access.recordScope ?? 'assigned',
          }),
        ),
      )
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    const { fuelCardPin: _fuelCardPin, ...safeVehicle } = vehicle;
    void _fuelCardPin;
    return NextResponse.json({ vehicle: safeVehicle });
  } catch (error) {
    console.error('[fleet/:id] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch vehicle' }, { status: 500 });
  }
}

/**
 * PATCH /api/fleet/[id]
 * Update a vehicle by ID.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/fleet', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_UPDATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { id } = await params;

    const [existing] = await db
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        vin: vehicles.vin,
        engineNumber: vehicles.engineNumber,
        status: vehicles.status,
        currentOdometer: vehicles.currentOdometer,
        officeId: vehicles.officeId,
        assignedOfficeId: vehicles.assignedOfficeId,
        updatedAt: vehicles.updatedAt,
      })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    const body = await req.json();
    if (body.fuelCardPin !== undefined) {
      return NextResponse.json(
        {
          error:
            'Fuel card PINs cannot be stored or changed through the general vehicle editor. Use a dedicated secure credential workflow.',
        },
        { status: 422 },
      );
    }

    const requestedLicenceNumber =
      body.licenceNumber === undefined ? undefined : String(body.licenceNumber).trim();
    if (requestedLicenceNumber !== undefined) {
      if (!requestedLicenceNumber) {
        return NextResponse.json({ error: 'Licence number cannot be blank' }, { status: 422 });
      }
      if (requestedLicenceNumber !== existing.licenceNumber) {
        const [duplicate] = await db
          .select({ id: vehicles.id })
          .from(vehicles)
          .where(
            and(
              eq(vehicles.tenantId, session.tenantId),
              sql<boolean>`lower(btrim(${vehicles.licenceNumber})) = lower(btrim(${requestedLicenceNumber}))`,
              eq(vehicles.isActive, true),
              ne(vehicles.id, id),
            ),
          )
          .limit(1);
        if (duplicate) {
          return NextResponse.json(
            { error: `Another active vehicle already uses licence number "${requestedLicenceNumber}"` },
            { status: 409 },
          );
        }
      }
    }

    let requestedOdometer: number | undefined;
    if (body.currentOdometer !== undefined) {
      requestedOdometer = Number(body.currentOdometer);
      if (!Number.isInteger(requestedOdometer) || requestedOdometer < 0) {
        return NextResponse.json(
          { error: 'Current odometer must be a non-negative whole number' },
          { status: 422 },
        );
      }
      if (requestedOdometer < existing.currentOdometer) {
        return NextResponse.json(
          {
            error: `Odometer cannot be reduced below the current reading (${existing.currentOdometer}). Use an audited odometer correction workflow for exceptional corrections.`,
          },
          { status: 409 },
        );
      }
    }

    const requestedStatus = body.status === undefined ? undefined : String(body.status).trim();
    if (requestedStatus !== undefined && requestedStatus !== existing.status) {
      if (['allocated', 'issued'].includes(existing.status)) {
        return NextResponse.json(
          {
            error: `Vehicle status is controlled by the active ${existing.status === 'issued' ? 'trip issue/return' : 'allocation'} workflow. Complete or replace that workflow instead of editing status directly.`,
          },
          { status: 409 },
        );
      }
      if (PROTECTED_REACTIVATION_STATUSES.has(existing.status)) {
        return NextResponse.json(
          {
            error:
              existing.status === 'written_off'
                ? 'A written-off vehicle cannot be reactivated through the general vehicle editor.'
                : 'Return this vehicle to service through the maintenance/defect resolution workflow so current safety blockers are rechecked.',
          },
          { status: 409 },
        );
      }
      if (requestedStatus === 'out_of_service') {
        return NextResponse.json(
          {
            error:
              'Use the audited decommission workflow to place a vehicle out of service. The general vehicle editor cannot perform this operational transition.',
          },
          { status: 422 },
        );
      }
      if (!MANUAL_EDIT_STATUSES.has(requestedStatus)) {
        return NextResponse.json(
          {
            error:
              'Allocated and issued statuses are controlled by allocation/trip workflows, and written-off status must use the audited decommission workflow.',
          },
          { status: 422 },
        );
      }
    }

    const requestedOfficeId =
      body.officeId === undefined ? undefined : body.officeId ? String(body.officeId) : null;
    const requestedAssignedOfficeId =
      body.assignedOfficeId === undefined
        ? undefined
        : body.assignedOfficeId
          ? String(body.assignedOfficeId)
          : null;
    if (
      (requestedOfficeId !== undefined && requestedOfficeId !== existing.officeId) ||
      (requestedAssignedOfficeId !== undefined &&
        requestedAssignedOfficeId !== existing.assignedOfficeId)
    ) {
      return NextResponse.json(
        {
          error:
            'Use the audited vehicle transfer workflow to change office ownership or assignment. The general vehicle editor cannot transfer a vehicle.',
        },
        { status: 422 },
      );
    }

    if (body.categoryId) {
      const [category] = await db
        .select({ id: vehicleCategories.id })
        .from(vehicleCategories)
        .where(
          and(
            eq(vehicleCategories.id, String(body.categoryId)),
            eq(vehicleCategories.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      if (!category) {
        return NextResponse.json({ error: 'Vehicle category not found in your tenant' }, { status: 422 });
      }
    }

    const updateData: Record<string, unknown> = {
      updatedBy: session.user.id,
      updatedAt: new Date(),
    };

    if (requestedLicenceNumber !== undefined) updateData.licenceNumber = requestedLicenceNumber;
    if (body.vehicleRegisterNumber !== undefined)
      updateData.vehicleRegisterNumber = body.vehicleRegisterNumber || null;
    if (body.vin !== undefined) updateData.vin = body.vin || null;
    if (body.engineNumber !== undefined) updateData.engineNumber = body.engineNumber || null;

    if (body.make !== undefined) updateData.make = body.make;
    if (body.model !== undefined) updateData.model = body.model;
    if (body.seriesName !== undefined) updateData.seriesName = body.seriesName || null;
    if (body.manufactureYear !== undefined)
      updateData.manufactureYear = body.manufactureYear ? Number(body.manufactureYear) : null;
    if (body.vehicleCategory !== undefined)
      updateData.vehicleCategory = body.vehicleCategory || null;
    if (body.vehicleDescription !== undefined)
      updateData.vehicleDescription = body.vehicleDescription || null;
    if (body.driveType !== undefined) updateData.driveType = body.driveType || null;
    if (body.colour !== undefined) updateData.colour = body.colour || null;
    if (body.fuelType !== undefined) updateData.fuelType = body.fuelType;
    if (body.transmission !== undefined) updateData.transmission = body.transmission;

    if (body.tareKg !== undefined) updateData.tareKg = body.tareKg ? Number(body.tareKg) : null;
    if (body.grossVehicleMassKg !== undefined)
      updateData.grossVehicleMassKg = body.grossVehicleMassKg
        ? Number(body.grossVehicleMassKg)
        : null;
    if (body.seatedCapacity !== undefined)
      updateData.seatedCapacity = body.seatedCapacity ? Number(body.seatedCapacity) : null;
    if (body.standingCapacity !== undefined)
      updateData.standingCapacity = body.standingCapacity ? Number(body.standingCapacity) : null;

    if (body.registeringAuthority !== undefined)
      updateData.registeringAuthority = body.registeringAuthority || null;
    if (body.nationalVehicleClassification !== undefined)
      updateData.nationalVehicleClassification = body.nationalVehicleClassification || null;
    if (body.roadworthyTestDate !== undefined)
      updateData.roadworthyTestDate = body.roadworthyTestDate || null;
    if (body.licenceExpiryDate !== undefined)
      updateData.licenceExpiryDate = body.licenceExpiryDate || null;

    if (requestedStatus !== undefined) updateData.status = requestedStatus;
    if (requestedOdometer !== undefined) updateData.currentOdometer = requestedOdometer;
    if (body.fuelCardNumber !== undefined) updateData.fuelCardNumber = body.fuelCardNumber || null;
    if (body.categoryId !== undefined) updateData.categoryId = body.categoryId || null;
    if (body.notes !== undefined) updateData.notes = body.notes || null;

    const vehicle = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(vehicles)
        .set(updateData)
        .where(
          and(
            eq(vehicles.id, id),
            eq(vehicles.tenantId, session.tenantId),
            eq(vehicles.status, existing.status),
            sql`date_trunc('milliseconds', ${vehicles.updatedAt}) = ${existing.updatedAt.toISOString()}::timestamptz`,
          ),
        )
        .returning();
      if (!updated) throw new Error(VEHICLE_UPDATE_CONFLICT);

      if (
        requestedOdometer !== undefined &&
        requestedOdometer !== existing.currentOdometer
      ) {
        await tx.insert(vehicleOdometerEvents).values({
          vehicleId: id,
          odometerValue: requestedOdometer,
          source: 'manual_correction',
          recordedByUserId: session.user.id,
          notes: `Fleet profile correction from ${existing.currentOdometer} km to ${requestedOdometer} km`,
        });
      }

      if (requestedStatus !== undefined && requestedStatus !== existing.status) {
        await tx.insert(vehicleStatusEvents).values({
          vehicleId: id,
          previousStatus: existing.status,
          newStatus: requestedStatus,
          reason: 'Manual status change through fleet profile editor',
          changedByUserId: session.user.id,
          referenceEntityType: 'vehicle_profile',
          referenceEntityId: id,
        });
      }

      const before = {
        licenceNumber: existing.licenceNumber,
        vehicleRegisterNumber: existing.vehicleRegisterNumber,
        vin: existing.vin,
        engineNumber: existing.engineNumber,
        status: existing.status,
      };
      const after = {
        licenceNumber: updated.licenceNumber,
        vehicleRegisterNumber: updated.vehicleRegisterNumber,
        vin: updated.vin,
        engineNumber: updated.engineNumber,
        status: updated.status,
      };
      const changed = (Object.keys(before) as Array<keyof typeof before>).filter(
        (field) => before[field] !== after[field],
      );
      if (changed.length) {
        const labels: Record<keyof typeof before, string> = {
          licenceNumber: 'registration',
          vehicleRegisterNumber: 'register number',
          vin: 'VIN/chassis',
          engineNumber: 'engine number',
          status: 'status',
        };
        await recordAuditEvent(
          {
            tenantId: session.tenantId,
            actorUserId: session.user.id,
            eventType: 'vehicle_identity_updated',
            action: 'vehicle.update',
            entityType: 'vehicle',
            entityId: id,
            before,
            after,
            summary: changed
              .map(
                (field) =>
                  `${labels[field]} changed from ${before[field] || 'not recorded'} to ${after[field] || 'not recorded'}`,
              )
              .join('; '),
          },
          tx,
        );
      }
      return updated;
    });

    vehicle.fuelCardPin = null;
    return NextResponse.json({ vehicle });
  } catch (error) {
    console.error('[fleet/:id] PATCH failed:', error);
    if (error instanceof Error && error.message.includes(VEHICLE_UPDATE_CONFLICT)) {
      return NextResponse.json(
        {
          error:
            'This vehicle changed while you were editing it. Refresh the fleet record and review the latest operational status before saving again.',
        },
        { status: 409 },
      );
    }
    const details = getDatabaseErrorDetails(error);
    if (
      details.code === '23505' ||
      details.message.includes('uq_vehicles_tenant_active_licence_normalized')
    ) {
      return NextResponse.json(
        { error: 'Another active vehicle already uses this licence number.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 });
  }
}
