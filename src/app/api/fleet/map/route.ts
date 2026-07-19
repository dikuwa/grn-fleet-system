import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { offices } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, isNull, sql } from 'drizzle-orm';

/**
 * GET /api/fleet/map
 * Returns vehicle locations with status, office coordinates, and trip context.
 * 
 * NOTE: Live GPS/telematics is out of scope for v1.
 * This endpoint returns vehicle positions based on their assigned office
 * location, with status markers showing availability, trips, and alerts.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Get vehicles with office and status info
    const rows = await db
      .select({
        id: vehicles.id,
        licenceNumber: vehicles.licenceNumber,
        make: vehicles.make,
        model: vehicles.model,
        colour: vehicles.colour,
        status: vehicles.status,
        currentOdometer: vehicles.currentOdometer,
        fuelType: vehicles.fuelType,
        // Office info
        officeId: offices.id,
        officeName: offices.name,
        officeAddress: offices.address,
        // Trip info (latest)
        hasOpenDefects: sql<boolean>`EXISTS (SELECT 1 FROM ${vehicleDefects} WHERE ${vehicleDefects.vehicleId} = ${vehicles.id} AND ${vehicleDefects.resolvedAt} IS NULL)`,
      })
      .from(vehicles)
      .leftJoin(offices, eq(vehicles.officeId, offices.id))
      .where(and(eq(vehicles.tenantId, session.tenantId), eq(vehicles.isActive, true)))
      .orderBy(vehicles.licenceNumber);

    // Get open defect counts per vehicle
    const openDefectCounts = await db
      .select({
        vehicleId: vehicleDefects.vehicleId,
        count: sql<number>`count(*)`,
      })
      .from(vehicleDefects)
      .where(isNull(vehicleDefects.resolvedAt))
      .groupBy(vehicleDefects.vehicleId);

    const defectCountMap = new Map(openDefectCounts.map((r) => [r.vehicleId, r.count]));

    // Namibia-specific approximate coordinates for reference
    // In a real deployment, offices would have lat/lng stored in the DB
    const regionCenters: Record<string, { lat: number; lng: number }> = {
      'Head Office': { lat: -22.5609, lng: 17.0658 },
      'Rundu': { lat: -17.9333, lng: 19.7667 },
      'Nkurenkuru': { lat: -17.6167, lng: 18.6000 },
      'Mukwe': { lat: -18.0667, lng: 21.4167 },
      'Ndiyona': { lat: -18.2167, lng: 20.7000 },
    };

    const vehiclesMap = rows.map((v) => {
      const officeName = v.officeName || 'Unassigned';
      const coord = regionCenters[officeName] || null;
      const openDefects = defectCountMap.get(v.id) ?? 0;

      return {
        id: v.id,
        licenceNumber: v.licenceNumber,
        make: v.make,
        model: v.model,
        colour: v.colour,
        status: v.status,
        currentOdometer: v.currentOdometer,
        fuelType: v.fuelType,
        office: { id: v.officeId, name: officeName, address: v.officeAddress },
        location: coord,
        openDefects,
        markerColor:
          v.status === 'available' ? '#22c55e' :
          v.status === 'issued' || v.status === 'allocated' ? '#3b82f6' :
          v.status === 'maintenance' ? '#f59e0b' :
          v.status === 'out_of_service' || v.status === 'written_off' ? '#ef4444' :
          '#a1a1aa',
      };
    });

    // Summary by status
    const summary = {
      total: vehiclesMap.length,
      available: vehiclesMap.filter((v) => v.status === 'available').length,
      onTrip: vehiclesMap.filter((v) => v.status === 'issued' || v.status === 'allocated').length,
      maintenance: vehiclesMap.filter((v) => v.status === 'maintenance').length,
      outOfService: vehiclesMap.filter((v) => v.status === 'out_of_service' || v.status === 'written_off').length,
      withDefects: vehiclesMap.filter((v) => v.openDefects > 0).length,
    };

    return NextResponse.json({ vehicles: vehiclesMap, summary, centers: regionCenters });
  } catch (error) {
    console.error('[fleet/map] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch fleet map data' }, { status: 500 });
  }
}
