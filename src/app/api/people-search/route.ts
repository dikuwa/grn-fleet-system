import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, ilike, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { departments, driverProfiles, employees, offices } from '@/db/schema/people';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const permission = await requireAnyPermission(session, [
    Permissions.REQUEST_CREATE,
    Permissions.STAFF_VIEW,
    Permissions.ALLOCATION_MANAGE,
    Permissions.ALLOCATION_CREATE,
  ]);
  if (permission instanceof NextResponse) return permission;

  const kind = request.nextUrl.searchParams.get('kind') === 'driver' ? 'driver' : 'employee';
  const query = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) || '';
  const limit = Math.min(30, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 20));
  const conditions = [
    eq(employees.tenantId, session.tenantId),
    eq(employees.employmentStatus, 'active'),
  ];

  if (kind === 'driver') {
    conditions.push(
      eq(employees.isDriver, true),
      eq(driverProfiles.driverStatus, 'authorised'),
    );
  }
  if (query) {
    conditions.push(
      or(
        ilike(employees.firstName, `%${query}%`),
        ilike(employees.lastName, `%${query}%`),
        ilike(employees.employeeNumber, `%${query}%`),
        ilike(employees.email, `%${query}%`),
        ilike(sql<string>`concat(${employees.firstName}, ' ', ${employees.lastName})`, `%${query}%`),
      )!,
    );
  }

  const db = getDb();
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
    })
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .leftJoin(offices, eq(employees.officeId, offices.id))
    .leftJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
    .where(and(...conditions))
    .orderBy(asc(employees.firstName), asc(employees.lastName))
    .limit(limit);

  const data = rows.map((row) => ({
      ...row,
      fullName: `${row.firstName} ${row.lastName}`.trim(),
    }));

  return NextResponse.json(
    { success: true, data },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}
