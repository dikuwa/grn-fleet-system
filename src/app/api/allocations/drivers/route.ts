/**
 * Driver eligibility picker for the Vehicle Allocation flow.
 *
 * GET /api/allocations/drivers?requestId=&vehicleId=&startDate=&endDate=&q=&page=&limit=
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
import { and, asc, eq, gt, inArray, lt } from 'drizzle-orm';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';
import { licenceCoversClass } from '@/lib/licence-classes';

const DEFAULT_TRIP_END_OFFSET_MS = 7 * 24 * 60 * 60 * 1000;
const LIVE_ALLOCATION_STATES = ['provisional', 'confirmed', 'released'] as const;

function parseOptionalDate(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

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
    const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || '25') || 25));
    const requestedStart = parseOptionalDate(searchParams.get('startDate'));
    const requestedEnd = parseOptionalDate(searchParams.get('endDate'));

    if (!requestId) {
      return NextResponse.json({ error: 'requestId is required' }, { status: 400 });
    }
    if (searchParams.get('startDate') && !requestedStart) {
      return NextResponse.json({ error: 'startDate is invalid' }, { status: 400 });
    }
    if (searchParams.get('endDate') && !requestedEnd) {
      return NextResponse.json({ error: 'endDate is invalid' }, { status: 400 });
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

    // Derive the request's full activity window. Explicit allocation dates from
    // the UI take precedence so eligibility always reflects the period the
    // officer is actually about to submit.
    const activities = await db
      .select({ startDate: requestActivities.startDate, endDate: requestActivities.endDate })
      .from(requestActivities)
      .where(eq(requestActivities.requestId, requestId));

    let activityStart: Date | null = null;
    let activityEnd: Date | null = null;
    if (activities.length > 0) {
      activityStart = activities.reduce(
        (min, activity) => (activity.startDate < min ? activity.startDate : min),
        activities[0].startDate,
      );
      activityEnd = activities.reduce(
        (max, activity) => (activity.endDate > max ? activity.endDate : max),
        activities[0].endDate,
      );
    }

    const tripStart = requestedStart ?? activityStart ?? new Date();
    const tripEnd = requestedEnd ?? activityEnd ?? new Date(tripStart.getTime() + DEFAULT_TRIP_END_OFFSET_MS);
    if (tripEnd <= tripStart) {
      return NextResponse.json({ error: 'Allocation end date must be after the start date' }, { status: 422 });
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
      if (!vehicle) {
        return NextResponse.json({ error: 'Vehicle not found in your organisation' }, { status: 404 });
      }
      requiredLicenceClass = vehicle.requiredLicenceClass;
      professionalAuthorisationRequired = vehicle.professionalAuthorisationRequired;
      vehicleCategoryName = vehicle.categoryName;
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
      .orderBy(asc(employees.lastName), asc(employees.firstName));

    if (driverEmployees.length === 0) {
      return NextResponse.json({ success: true, data: [], total: 0, page, limit, totalPages: 1 });
    }

    const employeeIds = driverEmployees.map((employee) => employee.id);
    const profiles = await db
      .select()
      .from(driverProfiles)
      .where(inArray(driverProfiles.employeeId, employeeIds));
    const profileMap = new Map(profiles.map((profile) => [profile.employeeId, profile]));
    const profileIds = profiles.map((profile) => profile.id);

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
            .where(and(inArray(driverLicenceCodes.licenceId, licenceIds), eq(driverLicenceCodes.isActive, true)))
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
            inArray(vehicleAllocations.state, [...LIVE_ALLOCATION_STATES]),
            lt(vehicleAllocations.startAt, tripEnd),
            gt(vehicleAllocations.endAt, tripStart),
          ),
        ),
    ]);

    // Highest-version active licence per profile. Eligibility below additionally
    // requires verificationStatus=verified, so a provisional active record cannot
    // accidentally make a driver selectable.
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
        availabilityStatus: employee.availabilityStatus,
        driverStatus: profile?.driverStatus ?? 'unauthorised',
        profileAvailabilityStatus: profile?.availabilityStatus ?? null,
        licenceNumber: licence?.licenceNumber ?? null,
        licenceClass: licence?.licenceClass ?? null,
        licenceExpiry: licence?.expiryDate ?? null,
        licenceVerificationStatus: licence?.verificationStatus ?? null,
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
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const safePage = Math.min(page, totalPages);
    const pageRows = filtered.slice((safePage - 1) * limit, (safePage - 1) * limit + limit);

    return NextResponse.json({
      success: true,
      data: pageRows,
      total,
      page: safePage,
      limit,
      totalPages,
      requestId,
      requiredLicenceClass,
      vehicleCategoryName,
      tripStartAt: tripStart.toISOString(),
      tripEndAt: tripEnd.toISOString(),
    });
  } catch (error) {
    console.error('[allocations/drivers] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load driver eligibility' }, { status: 500 });
  }
}
