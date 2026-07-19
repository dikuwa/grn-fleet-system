import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { maintenanceEvents } from '@/db/schema/fleet';
import { vehicles } from '@/db/schema/fleet';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';

/**
 * POST /api/maintenance
 * Create a new maintenance event for a vehicle.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const body = await req.json();

    const { vehicleId, serviceDate, serviceOdometer, serviceType, description, cost, vendorName, notes, nextServiceDate, nextServiceOdometer } = body;

    // Validate required fields
    if (!vehicleId) {
      return NextResponse.json({ error: 'Vehicle ID is required' }, { status: 400 });
    }
    if (!serviceDate) {
      return NextResponse.json({ error: 'Service date is required' }, { status: 400 });
    }
    if (!serviceType || !['scheduled', 'repair', 'inspection'].includes(serviceType)) {
      return NextResponse.json({ error: 'Service type must be scheduled, repair, or inspection' }, { status: 400 });
    }
    if (!description) {
      return NextResponse.json({ error: 'Description is required' }, { status: 400 });
    }

    // Verify vehicle exists and belongs to this tenant
    const [vehicle] = await db
      .select({ id: vehicles.id, status: vehicles.status })
      .from(vehicles)
      .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!vehicle) {
      return NextResponse.json({ error: 'Vehicle not found in your organisation' }, { status: 404 });
    }

    // Create the maintenance event
    const [event] = await db
      .insert(maintenanceEvents)
      .values({
        vehicleId,
        serviceDate,
        serviceOdometer: serviceOdometer ? Number(serviceOdometer) : null,
        serviceType,
        description,
        cost: cost ? String(cost) : null,
        vendorName: vendorName || null,
        notes: notes || null,
        nextServiceDate: nextServiceDate || null,
        nextServiceOdometer: nextServiceOdometer ? Number(nextServiceOdometer) : null,
        createdByUserId: session.user.id,
      })
      .returning();

    return NextResponse.json({ data: event }, { status: 201 });
  } catch (error) {
    console.error('[maintenance] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create maintenance event' }, { status: 500 });
  }
}
