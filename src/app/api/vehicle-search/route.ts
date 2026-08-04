import { NextRequest, NextResponse } from 'next/server';
import { and, asc, count, eq, ilike, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { vehicles, vehicleCategories } from '@/db/schema/fleet';
import { hasPermission, requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  // Optional: restrict to dashboard routes if needed
  const routeAccess = await requireDashboardAction(session, '/dashboard/requests/new', 'view');
  if (routeAccess instanceof NextResponse) return routeAccess;

  const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) || '';
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 25));
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);
  const offset = (page - 1) * limit;

  // Optional status filter
  const statusFilter = request.nextUrl.searchParams.get('status')?.trim() || '';

  const conditions = [
    eq(vehicles.tenantId, session.tenantId),
    eq(vehicles.isActive, true),
  ];

  if (statusFilter) {
    conditions.push(eq(vehicles.status, statusFilter));
  }

  if (query) {
    conditions.push(
      or(
        ilike(vehicles.licenceNumber, `%${query}%`),
        ilike(vehicles.vehicleRegisterNumber, `%${query}%`),
        ilike(vehicles.make, `%${query}%`),
        ilike(vehicles.model, `%${query}%`),
        ilike(vehicleCategories.name, `%${query}%`),
        ilike(vehicleCategories.code, `%${query}%`),
      )!
    );
  }

  const db = getDb();

  // Get total count for pagination
  const [{ count: total }] = await db
    .select({ count: count() })
    .from(vehicles)
    .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
    .where(and(...conditions));

  const rows = await db
    .select({
      id: vehicles.id,
      licenceNumber: vehicles.licenceNumber,
      vehicleRegisterNumber: vehicles.vehicleRegisterNumber,
      make: vehicles.make,
      model: vehicles.model,
      year: vehicles.manufactureYear,
      categoryName: vehicleCategories.name,
      categoryCode: vehicleCategories.code,
      status: vehicles.status,
      currentOdometer: vehicles.currentOdometer,
      fuelType: vehicles.fuelType,
      requiredLicenceClass: vehicles.requiredLicenceClass,
      professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
      seatedCapacity: vehicles.seatedCapacity,
      standingCapacity: vehicles.standingCapacity,
    })
    .from(vehicles)
    .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
    .where(and(...conditions))
    .orderBy(asc(vehicles.licenceNumber))
    .limit(limit)
    .offset(offset);

  const data = rows.map((row) => ({
    ...row,
    // Compute a display label
    label: `${row.licenceNumber} – ${row.make} ${row.model} (${row.categoryName})`,
  }));

  return NextResponse.json(
    {
      success: true,
      data,
      pagination: {
        total: Number(total),
        page,
        limit,
        totalPages: Math.ceil(Number(total) / limit),
      },
    },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
