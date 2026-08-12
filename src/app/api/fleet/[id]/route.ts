import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleCategories, vehicles } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, ne } from 'drizzle-orm';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { vehicleScopeCondition } from '@/lib/record-scope';

const MANUAL_EDIT_STATUSES = new Set(['available', 'provisional', 'maintenance', 'out_of_service']);

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

    // Fuel-card PINs are credentials, not fleet profile data. Never return the
    // stored value through a general vehicle-view endpoint shared with audit,
    // maintenance and inspection workspaces.
    const { fuelCardPin: _fuelCardPin, ...safeVehicle } = vehicle;
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

    // Verify vehicle exists and belongs to this tenant. Operational state is
    // loaded here so generic edits cannot silently undo trip/issue workflows.
    const [existing] = await db
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        status: vehicles.status,
        currentOdometer: vehicles.currentOdometer,
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
              eq(vehicles.licenceNumber, requestedLicenceNumber),
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

    // Tenant-owned foreign references must be validated independently because
    // UUID foreign keys alone do not encode tenant ownership.
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

    for (const [field, value] of [
      ['officeId', body.officeId],
      ['assignedOfficeId', body.assignedOfficeId],
    ] as const) {
      if (!value) continue;
      const [office] = await db
        .select({ id: offices.id })
        .from(offices)
        .where(and(eq(offices.id, String(value)), eq(offices.tenantId, session.tenantId)))
        .limit(1);
      if (!office) {
        return NextResponse.json(
          { error: `${field === 'officeId' ? 'Office' : 'Assigned office'} not found in your tenant` },
          { status: 422 },
        );
      }
    }

    // Build update payload — only include fields that were actually sent.
    const updateData: Record<string, unknown> = {
      updatedBy: session.user.id,
      updatedAt: new Date(),
    };

    // Section A — Identity
    if (requestedLicenceNumber !== undefined) updateData.licenceNumber = requestedLicenceNumber;
    if (body.vehicleRegisterNumber !== undefined)
      updateData.vehicleRegisterNumber = body.vehicleRegisterNumber || null;
    if (body.vin !== undefined) updateData.vin = body.vin || null;
    if (body.engineNumber !== undefined) updateData.engineNumber = body.engineNumber || null;

    // Section B — Description
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

    // Section C — Weight & capacity
    if (body.tareKg !== undefined) updateData.tareKg = body.tareKg ? Number(body.tareKg) : null;
    if (body.grossVehicleMassKg !== undefined)
      updateData.grossVehicleMassKg = body.grossVehicleMassKg
        ? Number(body.grossVehicleMassKg)
        : null;
    if (body.seatedCapacity !== undefined)
      updateData.seatedCapacity = body.seatedCapacity ? Number(body.seatedCapacity) : null;
    if (body.standingCapacity !== undefined)
      updateData.standingCapacity = body.standingCapacity ? Number(body.standingCapacity) : null;

    // Section D — Registration & compliance
    if (body.registeringAuthority !== undefined)
      updateData.registeringAuthority = body.registeringAuthority || null;
    if (body.nationalVehicleClassification !== undefined)
      updateData.nationalVehicleClassification = body.nationalVehicleClassification || null;
    if (body.roadworthyTestDate !== undefined)
      updateData.roadworthyTestDate = body.roadworthyTestDate || null;
    if (body.licenceExpiryDate !== undefined)
      updateData.licenceExpiryDate = body.licenceExpiryDate || null;

    // Section E — Fleet assignment
    if (requestedStatus !== undefined) updateData.status = requestedStatus;
    if (requestedOdometer !== undefined) updateData.currentOdometer = requestedOdometer;
    if (body.fuelCardNumber !== undefined) updateData.fuelCardNumber = body.fuelCardNumber || null;
    if (body.categoryId !== undefined) updateData.categoryId = body.categoryId || null;
    if (body.officeId !== undefined) updateData.officeId = body.officeId || null;
    if (body.assignedOfficeId !== undefined)
      updateData.assignedOfficeId = body.assignedOfficeId || null;
    if (body.notes !== undefined) updateData.notes = body.notes || null;

    const [vehicle] = await db
      .update(vehicles)
      .set(updateData)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .returning();

    if (vehicle) vehicle.fuelCardPin = null;
    return NextResponse.json({ vehicle });
  } catch (error) {
    console.error('[fleet/:id] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 });
  }
}
