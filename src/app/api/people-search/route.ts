import { NextRequest, NextResponse } from 'next/server';
import { and, asc, count, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { departments, driverProfiles, employees, offices } from '@/db/schema/people';
import { hasPermission, requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const routeAccess = await requireDashboardAction(session, '/dashboard/requests/new', 'view');
  if (routeAccess instanceof NextResponse) return routeAccess;

  const kind = request.nextUrl.searchParams.get('kind') === 'driver' ? 'driver' : 'employee';
  const requestedUnavailable = request.nextUrl.searchParams.get('showUnavailable') === 'true';
  const canViewUnavailable =
    requestedUnavailable && (await hasPermission(session, Permissions.STAFF_VIEW));
  const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) || '';
  const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 25));
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page')) || 1);
  const offset = (page - 1) * limit;

  // Employment status controls whether a person belongs in ordinary employee
  // selectors. Availability is an operational scheduling signal and must not
  // make an otherwise active staff member disappear from passenger/requester
  // selection. Driver searches remain availability-aware because nominating a
  // driver is an operational resource decision.
  const conditions = [
    eq(employees.tenantId, session.tenantId),
    eq(employees.employmentStatus, 'active'),
  ];

  if (kind === 'driver') {
    conditions.push(
      eq(employees.isDriver, true),
      eq(driverProfiles.driverStatus, 'authorised'),
      // Match the Transport Review licence lifecycle rule: only the highest-
      // version active licence is authoritative. The Requester picker must not
      // surface a driver whose current version is provisional/unverified or
      // already expired. Final submission performs the stronger trip-end check.
      sql`exists (
        select 1
        from driver_licences dl
        where dl.driver_profile_id = ${driverProfiles.id}
          and dl.is_active = true
          and dl.verification_status = 'verified'
          and dl.expiry_date >= current_date
          and not exists (
            select 1
            from driver_licences newer
            where newer.driver_profile_id = dl.driver_profile_id
              and newer.is_active = true
              and newer.version > dl.version
          )
      )`,
    );
    if (!canViewUnavailable) {
      conditions.push(
        eq(employees.availabilityStatus, 'available'),
        eq(driverProfiles.availabilityStatus, 'available'),
      );
    }
  }
  if (query) {
    // Request/passenger selection is an employee-directory lookup, not a
    // general identity search. Do not allow ordinary request users to probe
    // sensitive identifiers such as national ID, passport number or phone.
    conditions.push(
      or(
        ilike(employees.firstName, `%${query}%`),
        ilike(employees.lastName, `%${query}%`),
        ilike(employees.employeeNumber, `%${query}%`),
        ilike(employees.email, `%${query}%`),
        ilike(departments.name, `%${query}%`),
        ilike(offices.name, `%${query}%`),
        ilike(
          sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`,
          `%${query}%`,
        ),
      )!,
    );
  }

  const db = getDb();

  // Get total count for pagination
  const [{ count: total }] = await db
    .select({ count: count() })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(offices, eq(employees.officeId, offices.id))
    .leftJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
    .where(and(...conditions));

  const rows = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      employeeNumber: employees.employeeNumber,
      email: employees.email,
      jobTitle: employees.jobTitle,
      departmentName: departments.name,
      officeName: offices.name,
      driverStatus: driverProfiles.driverStatus,
      availabilityStatus: driverProfiles.availabilityStatus,
      employeeAvailabilityStatus: employees.availabilityStatus,
    })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(offices, eq(employees.officeId, offices.id))
    .leftJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
    .where(and(...conditions))
    .orderBy(asc(employees.firstName), asc(employees.lastName))
    .limit(limit)
    .offset(offset);

  const data = rows.map((row) => ({
    ...row,
    fullName: `${row.firstName} ${row.lastName}`.trim(),
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
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}