import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employeeAssignments, employees } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const permission = await requirePermission(auth.session, Permissions.STAFF_MANAGE);
  if (permission instanceof NextResponse) return permission;
  const body = await request.json() as {
    employeeNumber?: string;
    title?: string;
    firstName?: string;
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
  };
  if (!body.employeeNumber?.trim() || !body.firstName?.trim() || !body.lastName?.trim()) {
    return NextResponse.json({ error: 'Employee number, first name and surname are required.' }, { status: 400 });
  }
  const db = getDb();
  const [duplicate] = await db.select({ id: employees.id }).from(employees).where(and(
    eq(employees.tenantId, auth.session.tenantId),
    eq(employees.employeeNumber, body.employeeNumber.trim()),
  )).limit(1);
  if (duplicate) return NextResponse.json({ error: 'Employee number already exists in this organisation.' }, { status: 409 });
  const startDate = body.employmentStartDate || new Date().toISOString().slice(0, 10);
  const [employee] = await db.transaction(async (tx) => {
    const [record] = await tx.insert(employees).values({
      tenantId: auth.session.tenantId,
      employeeNumber: body.employeeNumber!.trim(),
      title: body.title?.trim() || null,
      firstName: body.firstName!.trim(),
      lastName: body.lastName!.trim(),
      preferredName: body.preferredName?.trim() || null,
      email: body.email?.trim().toLowerCase() || null,
      phone: body.phone?.trim() || null,
      jobTitle: body.jobTitle?.trim() || null,
      substantivePosition: body.substantivePosition?.trim() || body.jobTitle?.trim() || null,
      officeId: body.officeId || null,
      departmentId: body.departmentId || null,
      employmentType: body.employmentType || null,
      employmentStartDate: startDate,
      employmentStatus: 'active',
      availabilityStatus: 'available',
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
  return NextResponse.json({ data: employee }, { status: 201 });
}
