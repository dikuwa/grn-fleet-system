import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { departments, driverProfiles, employeeAssignments, employees, offices } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { allocateEmployeeNumber } from '@/lib/employee-number';

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const roleCheck = await requireDashboardAction(auth.session, '/dashboard/staff/new', 'create');
  if (roleCheck instanceof NextResponse) return roleCheck;
  const permission = await requirePermission(auth.session, Permissions.STAFF_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const body = await request.json() as {
    employeeNumber?: string;
    title?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    preferredName?: string;
    email?: string;
    phone?: string;
    jobTitle?: string;
    substantivePosition?: string;
    officeId?: string;
    departmentId?: string;
    employmentType?: string;
    employmentStartDate?: string;
    employmentStatus?: string;
    availabilityStatus?: string;
    gender?: string;
    isDriver?: boolean | string;
  };
  if (!body.firstName?.trim() || !body.lastName?.trim()) {
    return NextResponse.json({ error: 'First name and surname are required.' }, { status: 400 });
  }
  if (body.employmentStatus && !['active', 'inactive', 'suspended'].includes(body.employmentStatus)) {
    return NextResponse.json({ error: 'Unsupported employment status.' }, { status: 400 });
  }
  if (body.availabilityStatus && !['available', 'unavailable', 'leave'].includes(body.availabilityStatus)) {
    return NextResponse.json({ error: 'Unsupported availability status.' }, { status: 400 });
  }
  const db = getDb();
  if (body.officeId) {
    const [office] = await db.select({ id: offices.id }).from(offices).where(and(eq(offices.id, body.officeId), eq(offices.tenantId, auth.session.tenantId), eq(offices.isActive, true))).limit(1);
    if (!office) return NextResponse.json({ error: 'The selected office does not belong to this tenant.' }, { status: 400 });
  }
  if (body.departmentId) {
    const [department] = await db.select({ id: departments.id }).from(departments).where(and(eq(departments.id, body.departmentId), eq(departments.tenantId, auth.session.tenantId), eq(departments.isActive, true))).limit(1);
    if (!department) return NextResponse.json({ error: 'The selected department does not belong to this tenant.' }, { status: 400 });
  }
  const suppliedEmployeeNumber = body.employeeNumber?.trim() || null;
  if (suppliedEmployeeNumber) {
    const [duplicate] = await db.select({ id: employees.id }).from(employees).where(and(
      eq(employees.tenantId, auth.session.tenantId),
      eq(employees.employeeNumber, suppliedEmployeeNumber),
    )).limit(1);
    if (duplicate) return NextResponse.json({ error: `Employee number ${suppliedEmployeeNumber} is already assigned to another employee in this tenant.` }, { status: 409 });
  }
  const startDate = body.employmentStartDate || new Date().toISOString().slice(0, 10);
  const isDriver = body.isDriver === true || body.isDriver === 'true' || body.isDriver === 'on';
  const [employee] = await db.transaction(async (tx) => {
    const employeeNumber = suppliedEmployeeNumber || await allocateEmployeeNumber(tx, auth.session.tenantId);
    const [record] = await tx.insert(employees).values({
      tenantId: auth.session.tenantId,
      employeeNumber,
      title: body.title?.trim() || null,
      firstName: body.firstName!.trim(),
      middleName: body.middleName?.trim() || null,
      lastName: body.lastName!.trim(),
      gender: body.gender?.trim() || null,
      preferredName: body.preferredName?.trim() || null,
      email: body.email?.trim().toLowerCase() || null,
      phone: body.phone?.trim() || null,
      jobTitle: body.jobTitle?.trim() || null,
      substantivePosition: body.substantivePosition?.trim() || body.jobTitle?.trim() || null,
      officeId: body.officeId || null,
      departmentId: body.departmentId || null,
      employmentType: body.employmentType || null,
      employmentStartDate: startDate,
      employmentStatus: body.employmentStatus || 'active',
      availabilityStatus: body.availabilityStatus || 'available',
      isDriver,
    }).returning();
    await tx.insert(employeeAssignments).values({
      tenantId: auth.session.tenantId,
      employeeId: record.id,
      officeId: body.officeId || null,
      departmentId: body.departmentId || null,
      jobTitle: body.jobTitle?.trim() || null,
      position: body.substantivePosition?.trim() || body.jobTitle?.trim() || null,
      startDate,
      reason: 'Initial employee record',
      createdByUserId: auth.session.user.id,
    });
    if (isDriver) {
      await tx.insert(driverProfiles).values({ employeeId: record.id, driverStatus: 'incomplete', availabilityStatus: 'unavailable' });
    }
    return [record];
  });
  await recordAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.user.id,
    action: 'employee.created',
    entityType: 'employee',
    entityId: employee.id,
    after: employee,
    summary: `${employee.firstName} ${employee.lastName} added to the employee directory`,
  });
  if (!suppliedEmployeeNumber) {
    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'employee.number-generated',
      entityType: 'employee',
      entityId: employee.id,
      after: { employeeNumber: employee.employeeNumber },
      summary: `Generated employee number ${employee.employeeNumber}`,
    });
  }
  if (isDriver) {
    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'driver.profile-created',
      entityType: 'employee',
      entityId: employee.id,
      after: { driverStatus: 'incomplete' },
      summary: `Created incomplete driver profile for ${employee.firstName} ${employee.lastName}`,
    });
  }
  return NextResponse.json({ data: employee }, { status: 201 });
}
