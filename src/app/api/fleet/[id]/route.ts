import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

/**
 * GET /api/fleet/[id]
 * Fetch a single vehicle by ID.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { id } = await params;

    const [vehicle] = await db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    return NextResponse.json({ vehicle });
  } catch (error) {
    console.error('[fleet/:id] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch vehicle' }, { status: 500 });
  }
}

/**
 * PATCH /api/fleet/[id]
 * Update a vehicle by ID.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_UPDATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { id } = await params;

    // Verify vehicle exists and belongs to this tenant
    const [existing] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(and(eq(vehicles.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!existing) {
      return NextResponse.json({ error: 'Vehicle not found' }, { status: 404 });
    }

    const body = await req.json();

    // Build update payload — only include fields that were actually sent
    const updateData: Record<string, unknown> = {
      updatedBy: session.user.id,
    };

    // Section A — Identity
    if (body.licenceNumber !== undefined) updateData.licenceNumber = body.licenceNumber;
    if (body.vehicleRegisterNumber !== undefined) updateData.vehicleRegisterNumber = body.vehicleRegisterNumber || null;
    if (body.vin !== undefined) updateData.vin = body.vin || null;
    if (body.engineNumber !== undefined) updateData.engineNumber = body.engineNumber || null;

    // Section B — Description
    if (body.make !== undefined) updateData.make = body.make;
    if (body.model !== undefined) updateData.model = body.model;
    if (body.seriesName !== undefined) updateData.seriesName = body.seriesName || null;
    if (body.manufactureYear !== undefined) updateData.manufactureYear = body.manufactureYear ? Number(body.manufactureYear) : null;
    if (body.vehicleCategory !== undefined) updateData.vehicleCategory = body.vehicleCategory || null;
    if (body.vehicleDescription !== undefined) updateData.vehicleDescription = body.vehicleDescription || null;
    if (body.driveType !== undefined) updateData.driveType = body.driveType || null;
    if (body.colour !== undefined) updateData.colour = body.colour || null;
    if (body.fuelType !== undefined) updateData.fuelType = body.fuelType;
    if (body.transmission !== undefined) updateData.transmission = body.transmission;

    // Section C — Weight & capacity
    if (body.tareKg !== undefined) updateData.tareKg = body.tareKg ? Number(body.tareKg) : null;
    if (body.grossVehicleMassKg !== undefined) updateData.grossVehicleMassKg = body.grossVehicleMassKg ? Number(body.grossVehicleMassKg) : null;
    if (body.seatedCapacity !== undefined) updateData.seatedCapacity = body.seatedCapacity ? Number(body.seatedCapacity) : null;
    if (body.standingCapacity !== undefined) updateData.standingCapacity = body.standingCapacity ? Number(body.standingCapacity) : null;

    // Section D — Registration & compliance
    if (body.registeringAuthority !== undefined) updateData.registeringAuthority = body.registeringAuthority || null;
    if (body.nationalVehicleClassification !== undefined) updateData.nationalVehicleClassification = body.nationalVehicleClassification || null;
    if (body.roadworthyTestDate !== undefined) updateData.roadworthyTestDate = body.roadworthyTestDate || null;
    if (body.licenceExpiryDate !== undefined) updateData.licenceExpiryDate = body.licenceExpiryDate || null;

    // Section E — Fleet assignment
    if (body.status !== undefined) updateData.status = body.status;
    if (body.currentOdometer !== undefined) updateData.currentOdometer = Number(body.currentOdometer);
    if (body.fuelCardNumber !== undefined) updateData.fuelCardNumber = body.fuelCardNumber || null;
    if (body.fuelCardPin !== undefined) updateData.fuelCardPin = body.fuelCardPin || null;
    if (body.categoryId !== undefined) updateData.categoryId = body.categoryId || null;
    if (body.officeId !== undefined) updateData.officeId = body.officeId || null;
    if (body.assignedOfficeId !== undefined) updateData.assignedOfficeId = body.assignedOfficeId || null;
    if (body.notes !== undefined) updateData.notes = body.notes || null;

    const [vehicle] = await db
      .update(vehicles)
      .set(updateData)
      .where(eq(vehicles.id, id))
      .returning();

    return NextResponse.json({ vehicle });
  } catch (error) {
    console.error('[fleet/:id] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update vehicle' }, { status: 500 });
  }
}
