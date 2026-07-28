/**
 * Allocation Driver Assignment API
 *
 * PATCH /api/allocations/[id]/driver  — Assign a driver to an allocation
 * DELETE /api/allocations/[id]/driver  — Unassign the driver
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { vehicleAllocations } from '@/db/schema/trips';
import { vehicles } from '@/db/schema/fleet';
import {
  employees,
  driverProfiles,
  driverLicences,
  driverLicenceCodes,
  driverProfessionalAuthorisations,
} from '@/db/schema/people';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, gt, lt, inArray, ne, sql, desc } from 'drizzle-orm';
import { requireDashboardAction, requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { calculateDriverCompliance } from '@/lib/employee-lifecycle';
import { recordAuditEvent } from '@/lib/audit-event';
import { transportRequests } from '@/db/schema/requests';
import { recordTenantRequestActivity } from '@/lib/tenant-activity';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/allocations', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { driverEmployeeId } = body;

    if (!driverEmployeeId) {
      return NextResponse.json({ error: 'driverEmployeeId is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify allocation exists and belongs to this tenant
    const [allocation] = await db
      .select({
        id: vehicleAllocations.id,
        state: vehicleAllocations.state,
        startAt: vehicleAllocations.startAt,
        endAt: vehicleAllocations.endAt,
        driverEmployeeId: vehicleAllocations.driverEmployeeId,
        requestId: vehicleAllocations.requestId,
        requestReference: transportRequests.reference,
        requiredLicenceClass: vehicles.requiredLicenceClass,
        professionalAuthorisationRequired: vehicles.professionalAuthorisationRequired,
      })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .innerJoin(transportRequests, eq(vehicleAllocations.requestId, transportRequests.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }
    if (!['provisional', 'confirmed'].includes(allocation.state)) {
      return NextResponse.json({ error: 'Driver replacement is only allowed before physical issue' }, { status: 409 });
    }

    // Verify the employee exists, is a driver, and belongs to this tenant
    const [driver] = await db
      .select({
        id: employees.id,
        employeeStatus: employees.employmentStatus,
        employeeAvailability: employees.availabilityStatus,
        profileId: driverProfiles.id,
        driverStatus: driverProfiles.driverStatus,
        profileAvailability: driverProfiles.availabilityStatus,
        licenceId: driverLicences.id,
        licenceStatus: driverLicences.verificationStatus,
        licenceExpiry: driverLicences.expiryDate,
      })
      .from(employees)
      .innerJoin(driverProfiles, eq(driverProfiles.employeeId, employees.id))
      .innerJoin(driverLicences, eq(driverLicences.driverProfileId, driverProfiles.id))
      .where(and(
        eq(employees.id, driverEmployeeId),
        eq(employees.tenantId, session.tenantId),
        eq(employees.isDriver, true),
        eq(employees.employmentStatus, 'active'),
        eq(driverLicences.isActive, true),
      ))
      .orderBy(desc(driverLicences.version))
      .limit(1);

    if (!driver) {
      return NextResponse.json({ error: 'Driver has no active licence profile.' }, { status: 409 });
    }

    const [conflict] = await db.select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .where(and(
        eq(vehicleAllocations.driverEmployeeId, driverEmployeeId),
        ne(vehicleAllocations.id, id),
        inArray(vehicleAllocations.state, ['provisional', 'confirmed', 'issued']),
        lt(vehicleAllocations.startAt, allocation.endAt),
        gt(vehicleAllocations.endAt, allocation.startAt),
      ))
      .limit(1);
    if (conflict) return NextResponse.json({ error: 'Driver is already assigned during this period' }, { status: 409 });

    const [codes, professional] = await Promise.all([
      db.select({ code: driverLicenceCodes.code }).from(driverLicenceCodes)
        .where(and(eq(driverLicenceCodes.licenceId, driver.licenceId), eq(driverLicenceCodes.isActive, true))),
      db.select().from(driverProfessionalAuthorisations)
        .where(eq(driverProfessionalAuthorisations.driverProfileId, driver.profileId))
        .orderBy(desc(driverProfessionalAuthorisations.expiryDate)).limit(1),
    ]);
    const compliance = calculateDriverCompliance({
      employeeStatus: driver.employeeStatus,
      availabilityStatus: driver.employeeAvailability !== 'available' ? driver.employeeAvailability : driver.profileAvailability,
      driverStatus: driver.driverStatus,
      licenceStatus: driver.licenceStatus,
      licenceExpiry: driver.licenceExpiry,
      licenceCodes: codes.length ? codes.map((row) => row.code) : [],
      requiredLicenceClass: allocation.requiredLicenceClass,
      professionalRequired: allocation.professionalAuthorisationRequired,
      professionalVerified: professional[0]?.isVerified,
      professionalExpiry: professional[0]?.expiryDate,
      tripEndAt: allocation.endAt,
      hasScheduleConflict: false,
    });
    if (!['eligible', 'eligible_expiring_soon'].includes(compliance.status)) {
      return NextResponse.json({
        error: 'Driver does not meet the compliance requirements for this vehicle and trip period.',
        compliance,
      }, { status: 409 });
    }

    // Assign driver
    await db
      .update(vehicleAllocations)
      .set({ driverEmployeeId, version: sql`${vehicleAllocations.version} + 1`, updatedAt: new Date() })
      .where(eq(vehicleAllocations.id, id));

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: allocation.driverEmployeeId ? 'driver.replaced' : 'driver.assigned',
      entityType: 'allocation',
      entityId: id,
      summary: allocation.driverEmployeeId ? `Driver replaced: ${allocation.driverEmployeeId} → ${driverEmployeeId}` : `Driver ${driverEmployeeId} assigned to allocation`,
      before: { driverEmployeeId: allocation.driverEmployeeId },
      after: { driverEmployeeId, compliance },
    });
    await recordTenantRequestActivity({
      tenantId: session.tenantId,
      requestId: allocation.requestId,
      reference: allocation.requestReference,
      stage: 'driver_assigned',
      officeLabel: 'Transport office',
    });

    return NextResponse.json({ success: true, driverEmployeeId });
  } catch (error) {
    console.error('[Allocation Driver] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to assign driver' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const roleCheck = await requireDashboardAction(session, '/dashboard/allocations', 'update');
    if (roleCheck instanceof NextResponse) return roleCheck;

    const permCheck = await requirePermission(session, Permissions.ALLOCATION_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();

    // Verify allocation exists and belongs to this tenant
    const [allocation] = await db
      .select({ id: vehicleAllocations.id })
      .from(vehicleAllocations)
      .innerJoin(vehicles, eq(vehicleAllocations.vehicleId, vehicles.id))
      .where(and(eq(vehicleAllocations.id, id), eq(vehicles.tenantId, session.tenantId)))
      .limit(1);

    if (!allocation) {
      return NextResponse.json({ error: 'Allocation not found' }, { status: 404 });
    }

    // Unassign driver
    await db
      .update(vehicleAllocations)
      .set({ driverEmployeeId: null, updatedAt: new Date() })
      .where(eq(vehicleAllocations.id, id));

    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'driver_unassigned',
      actorUserId: session.user.id,
      action: 'unassign',
      entityType: 'allocation',
      entityId: id,
      summary: 'Driver removed from allocation',
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Allocation Driver] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to unassign driver' }, { status: 500 });
  }
}
