/**
 * Drivers API
 *
 * GET /api/drivers — List all drivers with licence information
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, departments, offices, driverProfiles, driverLicences } from '@/db/schema/people';
import { eq, and, or, asc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission, requireAnyPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { auditEvents } from '@/db/schema/audit';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.STAFF_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim() || '';
    const statusFilter = searchParams.get('status')?.trim() || 'all';
    const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || '25') || 25));

    const db = getDb();

    // Find all employees marked as drivers in this tenant
    const conditions = [
      eq(employees.tenantId, session.tenantId),
      eq(employees.isDriver, true),
      eq(employees.employmentStatus, 'active'),
    ];

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
      return NextResponse.json({
        success: true,
        data: [],
        stats: emptyStats(),
        total: 0,
        page,
        limit,
        totalPages: 1,
      });
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
      isActive: boolean;
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
          isActive: driverLicences.isActive,
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

    // Build enriched driver records with licence-expiry alert data so the
    // roster can surface expiring/expired licences without extra round-trips.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const enrichedDrivers = driverEmployees.map((emp) => {
      const profile = profileMap.get(emp.id);
      const licences = profile ? licencesByProfile.get(profile.id) || [] : [];

      const activeLicences = licences.filter((l) => l.verificationStatus === 'verified' || l.isActive);
      const expiries = activeLicences
        .map((l) => ({ id: l.id, licenceClass: l.licenceClass, expiryDate: l.expiryDate, daysUntil: Math.ceil((new Date(l.expiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) }))
        .sort((a, b) => a.daysUntil - b.daysUntil);
      const nextExpiry = expiries[0] ?? null;
      const hasExpiredLicence = expiries.some((e) => e.daysUntil < 0);
      const hasExpiringLicence = expiries.some((e) => e.daysUntil >= 0 && e.daysUntil <= 60);
      const hasValidLicence = expiries.length > 0 && !hasExpiredLicence;
      const hasVerifiedLicence = licences.some((l) => l.verificationStatus === 'verified');
      const pendingVerification =
        licences.length > 0 &&
        !hasVerifiedLicence &&
        licences.some((l) => ['uploaded', 'awaiting_review', 'needs_correction', 'pending'].includes(l.verificationStatus));

      return {
        ...emp,
        driverStatus: profile?.driverStatus || 'unauthorised',
        licenceCount: licences.length,
        activeLicenceCount: licences.filter(
          (l) => l.verificationStatus === 'verified' && new Date(l.expiryDate) > new Date(),
        ).length,
        nextExpiry,
        hasExpiredLicence,
        hasExpiringLicence,
        hasValidLicence,
        pendingVerification,
        licences: licences.map((l) => ({
          id: l.id,
          licenceNumber: l.licenceNumber,
          licenceClass: l.licenceClass,
          expiryDate: l.expiryDate,
          verificationStatus: l.verificationStatus,
          isActive: l.isActive,
        })),
      };
    });

    // Server-side stats across the whole tenant roster (not the filtered page).
    const stats = {
      total: enrichedDrivers.length,
      verifiedValid: enrichedDrivers.filter((d) => d.activeLicenceCount > 0).length,
      expiring: enrichedDrivers.filter((d) => d.hasExpiringLicence && !d.hasExpiredLicence).length,
      expired: enrichedDrivers.filter((d) => d.hasExpiredLicence).length,
      pendingVerification: enrichedDrivers.filter((d) => d.pendingVerification).length,
      ineligible: enrichedDrivers.filter(
        (d) => d.driverStatus !== 'authorised' || d.hasExpiredLicence || (d.licenceCount > 0 && d.activeLicenceCount === 0 && !d.pendingVerification),
      ).length,
      available: enrichedDrivers.filter((d) => d.driverStatus === 'authorised' && d.hasValidLicence).length,
    };

    // Search across driver + licence fields (name, employee number, licence
    // number, licence class).
    let filtered = enrichedDrivers;
    if (q) {
      const needle = q.toLowerCase();
      filtered = enrichedDrivers.filter(
        (driver) =>
          `${driver.firstName} ${driver.lastName}`.toLowerCase().includes(needle) ||
          driver.employeeNumber.toLowerCase().includes(needle) ||
          driver.licences.some(
            (l) =>
              l.licenceNumber.toLowerCase().includes(needle) ||
              l.licenceClass.toLowerCase().includes(needle),
          ),
      );
    }
    if (statusFilter === 'expired') filtered = filtered.filter((d) => d.hasExpiredLicence);
    else if (statusFilter === 'expiring') filtered = filtered.filter((d) => d.hasExpiringLicence && !d.hasExpiredLicence);
    else if (statusFilter === 'valid') filtered = filtered.filter((d) => d.hasValidLicence);
    else if (statusFilter === 'pending') filtered = filtered.filter((d) => d.pendingVerification);
    else if (statusFilter === 'no_licence') filtered = filtered.filter((d) => d.licenceCount === 0);

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const pageRows = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);

    return NextResponse.json({ success: true, data: pageRows, stats, total, page, limit, totalPages });
  } catch (error) {
    console.error('[Drivers] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list drivers' }, { status: 500 });
  }
}

function emptyStats() {
  return {
    total: 0,
    verifiedValid: 0,
    expiring: 0,
    expired: 0,
    pendingVerification: 0,
    ineligible: 0,
    available: 0,
  };
}

/** Convert an active staff member into a driver with verified or pending licence data. */
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
    const [employee] = await db.select({ id: employees.id, isDriver: employees.isDriver, employmentStatus: employees.employmentStatus, userId: employees.userId })
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

    // Even when reusing an existing profile, ensure the Driver role is assigned
    await ensureDriverRoleAssignment(db, employee, session);

    if (existingProfile) {
      return NextResponse.json({ error: 'This staff member already has a driver profile' }, { status: 409 });
    }

    const verified = body.verificationStatus === 'verified';
    const [profile] = await db.insert(driverProfiles).values({
      employeeId: employee.id,
      driverStatus: verified ? 'authorised' : 'pending_verification',
      availabilityStatus: verified ? (body.availabilityStatus || 'available') : 'unavailable',
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

    // Driver role was already assigned by ensureDriverRoleAssignment() above.
    // The second call is unnecessary since the function is called before the
    // 409 check — both new and reuse paths are covered by that single call.

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

/**
 * Ensure the employee has the "Assigned Driver" role in the role_assignment
 * system.  This is called both when creating a new profile and when reusing
 * an existing one (409 path) so that the workflow engine's permission check
 * (DRIVER_LOG_CREATE) always passes for the affected user.
 */
async function ensureDriverRoleAssignment(
  db: ReturnType<typeof getDb>,
  employee: { id: string; userId: string | null },
  session: { tenantId: string },
) {
  if (!employee.userId) return;
  const [membership] = await db
    .select({ id: tenantMemberships.id })
    .from(tenantMemberships)
    .where(
      and(
        eq(tenantMemberships.userId, employee.userId),
        eq(tenantMemberships.tenantId, session.tenantId),
      ),
    )
    .limit(1);
  if (!membership) return;
  const [driverRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, session.tenantId), eq(roles.name, 'Assigned Driver')))
    .limit(1);
  if (!driverRole) return;
  const [existing] = await db
    .select({ id: roleAssignments.id })
    .from(roleAssignments)
    .where(
      and(
        eq(roleAssignments.tenantMembershipId, membership.id),
        eq(roleAssignments.roleId, driverRole.id),
      ),
    )
    .limit(1);
  if (!existing) {
    await db.insert(roleAssignments).values({
      tenantMembershipId: membership.id,
      roleId: driverRole.id,
      startDate: new Date(),
      reason: 'Auto-assigned via driver profile creation',
    });
  }
}
