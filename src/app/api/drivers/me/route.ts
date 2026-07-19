import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, desc } from 'drizzle-orm';

/**
 * GET /api/drivers/me
 * Returns the current user's driver profile, licences, and employee info.
 * Used by the Driver Self-Service Portal.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();

    // Find the employee linked to the current user
    const employee = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        email: employees.email,
        phone: employees.phone,
        jobTitle: employees.jobTitle,
        employeeNumber: employees.employeeNumber,
        tenantId: employees.tenantId,
      })
      .from(employees)
      .where(
        and(
          eq(employees.userId, session.user.id),
          eq(employees.tenantId, session.tenantId),
        ),
      )
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!employee) {
      return NextResponse.json({ driver: null, error: 'No employee profile linked to your account' }, { status: 200 });
    }

    // Get driver profile
    const profile = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.employeeId, employee.id))
      .limit(1)
      .then((r) => r[0] ?? null);

    if (!profile) {
      return NextResponse.json({
        driver: null,
        employee,
        error: 'No driver profile found for this employee',
      }, { status: 200 });
    }

    // Get driver licences
    const licences = await db
      .select()
      .from(driverLicences)
      .where(eq(driverLicences.driverProfileId, profile.id))
      .orderBy(desc(driverLicences.expiryDate));

    return NextResponse.json({
      driver: {
        id: profile.id,
        employeeId: profile.employeeId,
        driverStatus: profile.driverStatus,
        internalAuthorisationRef: profile.internalAuthorisationRef,
        notes: profile.notes,
        employee: {
          firstName: employee.firstName,
          lastName: employee.lastName,
          email: employee.email,
          phone: employee.phone,
          jobTitle: employee.jobTitle,
          employeeNumber: employee.employeeNumber,
        },
        licences: licences.map((l) => ({
          id: l.id,
          licenceNumber: l.licenceNumber,
          licenceClass: l.licenceClass,
          issueDate: l.issueDate,
          expiryDate: l.expiryDate,
          allowedVehicleCategories: l.allowedVehicleCategories,
          verificationStatus: l.verificationStatus,
        })),
      },
    });
  } catch (error) {
    console.error('[drivers/me] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch driver profile' }, { status: 500 });
  }
}
