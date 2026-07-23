/**
 * Drivers API
 *
 * GET /api/drivers — List all drivers with licence information
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, departments, offices, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, or, ilike, asc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { auditEvents } from '@/db/schema/audit';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.STAFF_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

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

/** Convert an active staff member into an authorised driver. */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requireAnyPermission(session, [Permissions.DRIVER_MANAGE, Permissions.STAFF_MANAGE]);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const required = ['employeeId', 'licenceNumber', 'licenceClass', 'issueDate', 'expiryDate'];
    const missing = required.find((key) => !body[key]);
    if (missing) return NextResponse.json({ error: `${missing} is required` }, { status: 400 });
    if (new Date(body.expiryDate) <= new Date(body.issueDate)) {
      return NextResponse.json({ error: 'Licence expiry must be after the issue date' }, { status: 400 });
    }

    const db = getDb();
    const [employee] = await db.select({ id: employees.id, isDriver: employees.isDriver, employmentStatus: employees.employmentStatus })
      .from(employees)
      .where(and(eq(employees.id, body.employeeId), eq(employees.tenantId, session.tenantId)))
      .limit(1);
    if (!employee || employee.employmentStatus !== 'active') {
      return NextResponse.json({ error: 'Active staff member not found' }, { status: 404 });
    }

    const [existingProfile] = await db.select({ id: driverProfiles.id })
      .from(driverProfiles)
      .where(eq(driverProfiles.employeeId, employee.id))
      .limit(1);
    if (existingProfile) {
      return NextResponse.json({ error: 'This staff member already has a driver profile' }, { status: 409 });
    }

    const verified = body.verificationStatus === 'verified';
    const [profile] = await db.insert(driverProfiles).values({
      employeeId: employee.id,
      driverStatus: verified ? 'authorised' : 'suspended',
      availabilityStatus: body.availabilityStatus || 'available',
      internalAuthorisationRef: body.internalAuthorisationRef?.trim() || null,
      lastVerifiedAt: verified ? new Date() : null,
      verifiedByUserId: verified ? session.user.id : null,
      notes: body.notes?.trim() || null,
    }).returning();

    const [licence] = await db.insert(driverLicences).values({
      driverProfileId: profile.id,
      licenceNumber: body.licenceNumber.trim(),
      licenceClass: body.licenceClass.trim(),
      issueDate: body.issueDate,
      expiryDate: body.expiryDate,
      allowedVehicleCategories: body.allowedVehicleCategories?.trim() || null,
      isVerified: verified,
      verificationStatus: verified ? 'verified' : 'pending',
      notes: body.licenceNotes?.trim() || null,
    }).returning();

    await db.update(employees).set({ isDriver: true, updatedAt: new Date() }).where(eq(employees.id, employee.id));
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'driver_profile_created',
      actorUserId: session.user.id,
      action: 'create',
      entityType: 'driver_profile',
      entityId: profile.id,
      summary: `Staff member converted to driver with licence ${licence.licenceNumber}`,
      after: { employeeId: employee.id, profileId: profile.id, licenceId: licence.id, verified },
    });

    return NextResponse.json({ success: true, data: { profile, licence } }, { status: 201 });
  } catch (error) {
    console.error('[Drivers] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create driver profile' }, { status: 500 });
  }
}
