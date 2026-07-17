import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles, vehicleCategories } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, like, or, sql, type SQL } from 'drizzle-orm';

/**
 * GET /api/fleet
 * List vehicles with optional search/status/category filters.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status')?.trim();
    const categoryId = searchParams.get('category_id')?.trim();

    const conditions: SQL[] = [eq(vehicles.tenantId, session.tenantId)];

    if (status) conditions.push(eq(vehicles.status, status));
    if (categoryId) conditions.push(eq(vehicles.categoryId, categoryId));
    if (search) {
      conditions.push(
        or(
          like(vehicles.licenceNumber, `%${search}%`),
          like(vehicles.vehicleRegisterNumber, `%${search}%`),
          like(vehicles.vin, `%${search}%`),
          like(vehicles.engineNumber, `%${search}%`),
          like(vehicles.make, `%${search}%`),
          like(vehicles.model, `%${search}%`),
        )!,
      );
    }

    const rows = await db
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
        vin: vehicles.vin,
        engineNumber: vehicles.engineNumber,
        make: vehicles.make,
        model: vehicles.model,
        seriesName: vehicles.seriesName,
        manufactureYear: vehicles.manufactureYear,
        colour: vehicles.colour,
        fuelType: vehicles.fuelType,
        transmission: vehicles.transmission,
        currentOdometer: vehicles.currentOdometer,
        status: vehicles.status,
        categoryName: vehicleCategories.name,
      })
      .from(vehicles)
      .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
      .where(and(...conditions))
      .orderBy(vehicles.licenceNumber);

    return NextResponse.json({ rows });
  } catch (error) {
    console.error('[fleet] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch fleet' }, { status: 500 });
  }
}

/**
 * POST /api/fleet
 * Create a new vehicle with all schema fields.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_CREATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const body = await req.json();

    // Validate required fields
    if (!body.licenceNumber) {
      return NextResponse.json({ error: 'Licence number is required' }, { status: 400 });
    }
    if (!body.make) {
      return NextResponse.json({ error: 'Make is required' }, { status: 400 });
    }
    if (!body.model) {
      return NextResponse.json({ error: 'Model is required' }, { status: 400 });
    }

    // Check for duplicate licence number within tenant
    const [existing] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(
        and(
          eq(vehicles.licenceNumber, body.licenceNumber),
          eq(vehicles.tenantId, session.tenantId),
          eq(vehicles.isActive, true),
        ),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: `A vehicle with licence number "${body.licenceNumber}" already exists in your fleet` },
        { status: 409 },
      );
    }

    const [vehicle] = await db
      .insert(vehicles)
      .values({
        tenantId: session.tenantId,
        createdBy: session.user.id,
        updatedBy: session.user.id,

        // Section A — Identity
        licenceNumber: body.licenceNumber,
        vehicleRegisterNumber: body.vehicleRegisterNumber || null,
        vin: body.vin || null,
        engineNumber: body.engineNumber || null,

        // Section B — Description
        make: body.make,
        model: body.model,
        seriesName: body.seriesName || null,
        manufactureYear: body.manufactureYear ? Number(body.manufactureYear) : null,
        vehicleCategory: body.vehicleCategory || null,
        vehicleDescription: body.vehicleDescription || null,
        driveType: body.driveType || null,
        colour: body.colour || null,
        fuelType: body.fuelType || 'petrol',
        transmission: body.transmission || 'manual',

        // Section C — Weight & capacity
        tareKg: body.tareKg ? Number(body.tareKg) : null,
        grossVehicleMassKg: body.grossVehicleMassKg ? Number(body.grossVehicleMassKg) : null,
        seatedCapacity: body.seatedCapacity ? Number(body.seatedCapacity) : null,
        standingCapacity: body.standingCapacity ? Number(body.standingCapacity) : null,

        // Section D — Registration & compliance
        registeringAuthority: body.registeringAuthority || null,
        nationalVehicleClassification: body.nationalVehicleClassification || null,
        roadworthyTestDate: body.roadworthyTestDate || null,
        licenceExpiryDate: body.licenceExpiryDate || null,

        // Section E — Fleet assignment
        status: body.status || 'available',
        currentOdometer: body.currentOdometer ? Number(body.currentOdometer) : 0,
        fuelCardNumber: body.fuelCardNumber || null,
        fuelCardPin: body.fuelCardPin || null,
        categoryId: body.categoryId || null,
        officeId: body.officeId || null,
        assignedOfficeId: body.assignedOfficeId || null,

        notes: body.notes || null,
        isActive: true,
      })
      .returning();

    return NextResponse.json({ vehicle }, { status: 201 });
  } catch (error) {
    console.error('[fleet] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create vehicle' }, { status: 500 });
  }
}
