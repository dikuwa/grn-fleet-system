import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, driverProfiles, driverLicences } from '@/db/schema/people';
import { requireRequestAuth } from '@/lib/auth-helpers';

import { eq, and, desc } from 'drizzle-orm';

const SELF_SERVICE_TERMINAL_HISTORY = new Set(['superseded', 'rejected', 'expired']);

/**
 * GET /api/drivers/me
 * Returns the current user's driver profile, current/reviewable licences, and employee info.
 * Superseded/rejected/expired historical licence versions remain preserved in the database
 * and Transport review history, but are deliberately omitted from the Driver's current
 * compliance feed so an old terminal version cannot produce a false expiry alert after renewal.
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
      return NextResponse.json(
        { driver: null, error: 'No employee profile linked to your account' },
        { status: 200 },
      );
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

    // Preserve all versions in storage/database, but expose only records that are relevant
    // to the Driver's current compliance or an in-flight renewal submission.
    const allLicences = await db
      .select()
      .from(driverLicences)
      .where(eq(driverLicences.driverProfileId, profile.id))
      .orderBy(desc(driverLicences.version));

    const licences = allLicences.filter(
      (licence) => licence.isActive || !SELF_SERVICE_TERMINAL_HISTORY.has(licence.verificationStatus),
    );

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
          isActive: l.isActive,
          version: l.version,
        })),
        licenceHistoryCount: allLicences.length,
      },
    });
  } catch (error) {
    console.error('[drivers/me] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch driver profile' }, { status: 500 });
  }
}
