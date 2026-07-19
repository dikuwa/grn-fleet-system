/**
 * Drivers API
 *
 * GET /api/drivers — List all drivers with licence information
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, departments, offices, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, or, ilike, asc } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || '';

    const db = getDb();

    // Find all employees marked as drivers in this tenant
    const conditions = [
      eq(employees.tenantId, session.tenantId),
      eq(employees.isDriver, true),
      eq(employees.employmentStatus, 'active'),
    ];

    if (q) {
      conditions.push(
        or(
          ilike(employees.firstName, `%${q}%`),
          ilike(employees.lastName, `%${q}%`),
          ilike(employees.employeeNumber, `%${q}%`),
        )!,
      );
    }

    const driverEmployees = await db
      .select({
        id: employees.id,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        jobTitle: employees.jobTitle,
        employmentStatus: employees.employmentStatus,
        departmentName: departments.name,
        officeName: offices.name,
      })
      .from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(offices, eq(employees.officeId, offices.id))
      .where(and(...conditions))
      .orderBy(asc(employees.lastName));

    if (driverEmployees.length === 0) {
      return NextResponse.json({ success: true, data: [] });
    }

    // Fetch all driver profiles for these employees
    const employeeIds = driverEmployees.map((e) => e.id);

    const allProfiles = await db
      .select()
      .from(driverProfiles)
      .where(
        or(...employeeIds.map((id) => eq(driverProfiles.employeeId, id)))!,
      );

    const profileMap = new Map(allProfiles.map((p) => [p.employeeId, p]));

    // Get licences for all profiles
    const profileIds = allProfiles.map((p) => p.id);
    let allLicences: Array<{
      id: string;
      driverProfileId: string;
      licenceNumber: string;
      licenceClass: string;
      expiryDate: string;
      verificationStatus: string;
    }> = [];

    if (profileIds.length > 0) {
      const conditions2 = profileIds.map((pid) => eq(driverLicences.driverProfileId, pid));
      allLicences = await db
        .select({
          id: driverLicences.id,
          driverProfileId: driverLicences.driverProfileId,
          licenceNumber: driverLicences.licenceNumber,
          licenceClass: driverLicences.licenceClass,
          expiryDate: driverLicences.expiryDate,
          verificationStatus: driverLicences.verificationStatus,
        })
        .from(driverLicences)
        .where(or(...conditions2)!)
        .orderBy(asc(driverLicences.expiryDate));
    }

    const licencesByProfile = new Map<string, typeof allLicences>();
    for (const licence of allLicences) {
      const list = licencesByProfile.get(licence.driverProfileId) || [];
      list.push(licence);
      licencesByProfile.set(licence.driverProfileId, list);
    }

    // Build enriched driver records
    const enrichedDrivers = driverEmployees.map((emp) => {
      const profile = profileMap.get(emp.id);
      const licences = profile ? licencesByProfile.get(profile.id) || [] : [];

      return {
        ...emp,
        driverStatus: profile?.driverStatus || 'unauthorised',
        licenceCount: licences.length,
        activeLicenceCount: licences.filter(
          (l) => l.verificationStatus === 'verified' && new Date(l.expiryDate) > new Date(),
        ).length,
        licences,
      };
    });

    return NextResponse.json({ success: true, data: enrichedDrivers });
  } catch (error) {
    console.error('[Drivers] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list drivers' }, { status: 500 });
  }
}
