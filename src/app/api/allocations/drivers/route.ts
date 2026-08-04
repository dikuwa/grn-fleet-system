/**
 * Driver eligibility picker for the Vehicle Allocation flow.
 *
 * GET /api/allocations/drivers?requestId=&vehicleId=&q=&page=&limit=
 *
 * Returns every tenant driver with a real-time compliance verdict for the
 * selected request + vehicle, so the Transport Officer can see why a known
 * driver is excluded (never hidden silently).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import {
  departments,
  driverLicenceCodes,
  driverLicences,
  driverProfessionalAuthorisations,
  driverProfiles,
  employees,
  offices,
} from '@/db/schema/people';
import { requestActivities, transportRequests } from '@/db/schema/requests';
import { vehicleCategories, vehicles } from '@/db/schema/fleet';
import { vehicleAllocations } from '@/db/schema/trips';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';
import { licenceCoversClass } from '@/lib/licence-classes';

const DEFAULT_TRIP_END_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requireAnyPermission(session, [
      Permissions.ALLOCATION_MANAGE,
      Permissions.ALLOCATION_CREATE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('requestId')?.trim();
    const vehicleId = searchParams.get('vehicleId')?.trim() || null;
    const q = searchParams.get('q')?.trim() || '';
    const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || '10') || 10));

    if (!requestId) {
      return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
    }

    const db = getDb();
    const tenantId = session.tenantId;

    const [requestRow] = await db
      .select({ id: transportRequests.id })
      .from(transportRequests)
      .where(and(eq(transportRequests.id, requestId), eq(transportRequests.tenantId, tenantId)))
      .limit(1);
    if (!requestRow) {
      return NextResponse.json({ error: 'Transport request not found' }, { status: 404 });
    }

    // Trip window from the request's programme of activities.
    const activities = await db
      .select({ startDate: requestActivities.startDate, endDate: requestActivities.endDate })
      .from(requestActivities)
      .where(eq(requestActivities.requestId, requestId));
    let tripEndAt: Date | null = null;
    if (activities.length > 0) {
      tripEndAt = activities.reduce((max, a) => (a.endDate > max ? a.endDate : max), activities[0].endDate);
    }

    // Vehicle requirements (class + professional authorisation) when one is chosen.
    let requiredLicenceClass: string | null = null;
    let professionalAuthorisationRequired = false;
    let vehicleCategoryName: string | null = null;
    if (vehicleId) {
      const [vehicle] = await db
        .select({
          requiredLicenceClass: vehicles.requiredLicenceClass,
          professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
          categoryName: vehicleCategories.name,
        })
        .from(vehicles)
        .leftJoin(vehicleCategories, eq(vehicles.categoryId, vehicleCategories.id))
        .where(and(eq(vehicles.id, vehicleId), eq(vehicles.tenantId, tenantId)))
        .limit(1);
      if (vehicle) {
        requiredLicenceClass = vehicle.requiredLicenceClass;
        professionalAuthorisationRequired = vehicle.professionalAuthorisationRequired;
        vehicleCategoryName = vehicle.categoryName;
      }
    }

    // Every tenant driver — including currently-ineligible ones, so officers
    // understand why a known driver cannot be selected.
    const driverEmployees = await db
      .select({
        id: employees.id,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        jobTitle: employees.jobTitle,
        employmentStatus: employees.employmentStatus,
        availabilityStatus: employees.availabilityStatus,
        userId: employees.userId,
        departmentName: departments.name,
        officeName: offices.name,
      })
      .from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(offices, eq(employees.officeId, offices.id))
      .where(and(eq(employees.tenantId, tenantId), eq(employees.isDriver, true)))
      .orderBy(asc(employees.lastName));

    if (driverEmployees.length === 0) {
      return NextResponse.json({ success: true, data: [], total: 0, page, limit, totalPages: 1 });
    }

    const employeeIds = driverEmployees.map((e) => e.id);
    const profiles = await db
      .select()
      .from(driverProfiles)
      .where(inArray(driverProfiles.employeeId, employeeIds));
    const profileMap = new Map(profiles.map((p) => [p.employeeId, p]));
    const profileIds = profiles.map((p) => p.id);

    // Fetch active licences first so we can scope codes to exactly those licence rows.
    const licences =
      profileIds.length > 0
        ? await db
            .select()
            .from(driverLicences)
            .where(and(inArray(driverLicences.driverProfileId, profileIds), eq(driverLicences.isActive, true)))
        : [];
    const licenceIds = licences.map((licence) => licence.id);

    const [codes, professionals, driverAllocations] = await Promise.all([
      licenceIds.length > 0
        ? db
            .select({ licenceId: driverLicenceCodes.licenceId, code: driverLicenceCodes.code })
            .from(driverLicenceCodes)
            .where(inArray(driverLicenceCodes.licenceId, licenceIds))
        : Promise.resolve([]),
      profileIds.length > 0
        ? db
            .select()
            .from(driverProfessionalAuthorisations)
            .where(inArray(driverProfessionalAuthorisations.driverProfileId, profileIds))
        : Promise.resolve([]),
      db
        .select({ driverEmployeeId: vehicleAllocations.driverEmployeeId })
        .from(vehicleAllocations)
        .where(
          and(
            inArray(vehicleAllocations.driverEmployeeId, employeeIds),
            inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
          ),
        ),
    ]);

    // Highest-version active licence per profile.
    const licencesByProfile = new Map<string, (typeof licences)[number]>();
    for (const licence of licences) {
      const current = licencesByProfile.get(licence.driverProfileId);
      if (!current || licence.version > current.version) {
        licencesByProfile.set(licence.driverProfileId, licence);
      }
    }
    const codeMap = new Map<string, string[]>();
    for (const row of codes) {
      const list = codeMap.get(row.licenceId) ?? [];
      list.push(row.code);
      codeMap.set(row.licenceId, list);
    }
    const professionalMap = new Map<string, (typeof professionals)[number]>();
    for (const row of professionals) {
      const current = professionalMap.get(row.driverProfileId);
      if (!current || row.expiryDate > current.expiryDate) {
        professionalMap.set(row.driverProfileId, row);
      }
    }
    const conflictedDrivers = new Set(
      driverAllocations.map((row) => row.driverEmployeeId).filter((value): value is string => Boolean(value)),
    );

    const tripEnd = tripEndAt ?? new Date(Date.now() + DEFAULT_TRIP_END_OFFSET_MS);

    const drivers = driverEmployees.map((employee) => {
      const profile = profileMap.get(employee.id);
      const licence = profile ? licencesByProfile.get(profile.id) : undefined;
      const licenceCodes = licence
        ? [
            ...(codeMap.get(licence.id) ?? []),
            ...String(licence.licenceClass || '')
              .split(',')
              .map((code) => code.trim())
              .filter(Boolean),
          ]
        : [];
      const professional = profile ? professionalMap.get(profile.id) : undefined;

      const compliance = calculateDriverCompliance({
        employeeStatus: employee.employmentStatus,
        availabilityStatus:
          employee.availabilityStatus !== 'available'
            ? employee.availabilityStatus
            : profile?.availabilityStatus || 'available',
        driverStatus: profile?.driverStatus || 'unauthorised',
        licenceStatus: licence?.verificationStatus ?? null,
        licenceExpiry: licence?.expiryDate ?? null,
        licenceCodes: Array.from(new Set(licenceCodes)),
        requiredLicenceClass: requiredLicenceClass || undefined,
        professionalRequired: professionalAuthorisationRequired,
        professionalVerified: professional?.isVerified,
        professionalExpiry: professional?.expiryDate ?? null,
        tripEndAt: tripEnd,
        hasScheduleConflict: conflictedDrivers.has(employee.id),
      });

      const eligible =
        compliance.status === 'eligible' || compliance.status === 'eligible_expiring_soon';

      return {
        employeeId: employee.id,
        firstName: employee.firstName,
        lastName: employee.lastName,
        employeeNumber: employee.employeeNumber,
        jobTitle: employee.jobTitle,
        departmentName: employee.departmentName,
        officeName: employee.officeName,
        employmentStatus: employee.employmentStatus,
        driverStatus: profile?.driverStatus ?? 'unauthorised',
        licenceNumber: licence?.licenceNumber ?? null,
        licenceClass: licence?.licenceClass ?? null,
        licenceExpiry: licence?.expiryDate ?? null,
        licenceClassCompatible: licenceCoversClass(licence?.licenceClass, requiredLicenceClass),
        eligible,
        compliance,
      };
    });

    let filtered = drivers;
    if (q) {
      const needle = q.toLowerCase();
      filtered = drivers.filter(
        (driver) =>
          driver.firstName.toLowerCase().includes(needle) ||
          driver.lastName.toLowerCase().includes(needle) ||
          driver.employeeNumber.toLowerCase().includes(needle) ||
          (driver.licenceNumber ?? '').toLowerCase().includes(needle) ||
          (driver.licenceClass ?? '').toLowerCase().includes(needle),
      );
    }

    const total = filtered.length;
    const pageRows = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);

    return NextResponse.json({
      success: true,
      data: pageRows,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      requestId,
      requiredLicenceClass,
      vehicleCategoryName,
      tripEndAt: tripEnd.toISOString(),
    });
  } catch (error) {
    console.error('[allocations/drivers] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load driver eligibility' }, { status: 500 });
  }
}
