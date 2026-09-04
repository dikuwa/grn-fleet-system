import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles, vehicleCategories } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import {
  getSessionRoleNames,
  requireDashboardAction,
  requireRequestAuth,
  requirePermission,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, ilike, or, count, sql, type SQL } from 'drizzle-orm';
import { resolveDashboardAccess } from '@/lib/dashboard-access';
import { vehicleScopeCondition } from '@/lib/record-scope';
import { getTenantEntitlements, checkEntitlement } from '@/lib/entitlements';
import { getDatabaseErrorDetails } from '@/lib/database-error-details';

const INITIAL_VEHICLE_STATUSES = new Set(['available', 'provisional', 'maintenance', 'out_of_service']);

/**
 * GET /api/fleet
 * List vehicles with optional search/status/category filters.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/fleet', 'view');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search')?.trim();
    const status = searchParams.get('status')?.trim();
    const categoryId = searchParams.get('category_id')?.trim();

    const roleNames = await getSessionRoleNames(session);
    const access = resolveDashboardAccess('/dashboard/fleet', roleNames);
    const conditions: SQL[] = [
      vehicleScopeCondition({
        tenantId: session.tenantId,
        userId: session.user.id,
        recordScope: access.recordScope ?? 'assigned',
      }),
    ];

    if (status) conditions.push(eq(vehicles.status, status));
    if (categoryId) conditions.push(eq(vehicles.categoryId, categoryId));
    if (search) {
      conditions.push(
        or(
          ilike(vehicles.licenceNumber, `%${search}%`),
          ilike(vehicles.vehicleRegisterNumber, `%${search}%`),
          ilike(vehicles.vin, `%${search}%`),
          ilike(vehicles.engineNumber, `%${search}%`),
          ilike(vehicles.make, `%${search}%`),
          ilike(vehicles.model, `%${search}%`),
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
      .leftJoin(
        vehicleCategories,
        and(
          eq(vehicles.categoryId, vehicleCategories.id),
          eq(vehicleCategories.tenantId, session.tenantId),
        ),
      )
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
    const roleCheck = await requireDashboardAction(session, '/dashboard/fleet/new', 'create');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_CREATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const body = await req.json();

    if (body.fuelCardPin !== undefined) {
      return NextResponse.json(
        {
          error:
            'Fuel card PINs cannot be stored through the general fleet form. Use a dedicated secure credential workflow.',
        },
        { status: 422 },
      );
    }

    const licenceNumber = String(body.licenceNumber || '').trim();
    const make = String(body.make || '').trim();
    const model = String(body.model || '').trim();
    if (!licenceNumber) {
      return NextResponse.json({ error: 'Licence number is required' }, { status: 400 });
    }
    if (!make) {
      return NextResponse.json({ error: 'Make is required' }, { status: 400 });
    }
    if (!model) {
      return NextResponse.json({ error: 'Model is required' }, { status: 400 });
    }

    const requestedStatus = String(body.status || 'available').trim();
    if (!INITIAL_VEHICLE_STATUSES.has(requestedStatus)) {
      return NextResponse.json(
        {
          error:
            'New vehicles may start as available, provisional, maintenance, or out of service. Allocation and issued states are controlled by operational workflows.',
        },
        { status: 422 },
      );
    }

    const currentOdometer = body.currentOdometer === undefined || body.currentOdometer === ''
      ? 0
      : Number(body.currentOdometer);
    if (!Number.isInteger(currentOdometer) || currentOdometer < 0) {
      return NextResponse.json(
        { error: 'Current odometer must be a non-negative whole number' },
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

    for (const value of [body.officeId, body.assignedOfficeId]) {
      if (!value) continue;
      const [office] = await db
        .select({ id: offices.id })
        .from(offices)
        .where(and(eq(offices.id, String(value)), eq(offices.tenantId, session.tenantId)))
        .limit(1);
      if (!office) {
        return NextResponse.json({ error: 'Selected office not found in your tenant' }, { status: 422 });
      }
    }

    // Enforce the tenant's subscription vehicle limit before creating.
    const entitlements = await getTenantEntitlements(session.tenantId);
    if (entitlements) {
      const [countRow] = await db
        .select({ total: count() })
        .from(vehicles)
        .where(eq(vehicles.tenantId, session.tenantId));
      const vehicleCheck = checkEntitlement(
        entitlements,
        'vehicles',
        countRow?.total ?? 0,
        1,
      );
      if (!vehicleCheck.ok) {
        return NextResponse.json(
          { error: vehicleCheck.message || 'Vehicle limit reached' },
          { status: 409 },
        );
      }
    }

    // Friendly pre-check uses the same normalisation as the database unique
    // invariant. The unique index remains authoritative under concurrency.
    const [existing] = await db
      .select({ id: vehicles.id })
      .from(vehicles)
      .where(
        and(
          sql<boolean>`lower(btrim(${vehicles.licenceNumber})) = lower(btrim(${licenceNumber}))`,
          eq(vehicles.tenantId, session.tenantId),
          eq(vehicles.isActive, true),
        ),
      )
      .limit(1);

    if (existing) {
      return NextResponse.json(
        { error: `A vehicle with licence number "${licenceNumber}" already exists in your fleet` },
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
        licenceNumber,
        vehicleRegisterNumber: body.vehicleRegisterNumber || null,
        vin: body.vin || null,
        engineNumber: body.engineNumber || null,

        // Section B — Description
        make,
        model,
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
        status: requestedStatus,
        currentOdometer,
        fuelCardNumber: body.fuelCardNumber || null,
        categoryId: body.categoryId || null,
        officeId: body.officeId || null,
        assignedOfficeId: body.assignedOfficeId || null,

        notes: body.notes || null,
        isActive: true,
      })
      .returning();

    if (vehicle) vehicle.fuelCardPin = null;
    return NextResponse.json({ vehicle }, { status: 201 });
  } catch (error) {
    console.error('[fleet] POST failed:', error);
    const details = getDatabaseErrorDetails(error);
    if (
      details.code === '23505' ||
      details.message.includes('uq_vehicles_tenant_active_licence_normalized')
    ) {
      return NextResponse.json(
        { error: 'An active vehicle with this licence number already exists in your fleet.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to create vehicle' }, { status: 500 });
  }
}
