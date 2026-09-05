import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { departmentOffices, departments, employeeAssignments, employees, transportRequests, workflowDefinitions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { PATCH as patchDepartment } from '../route';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Organisation unit not found.' }, { status: 404 });
  }
  return patchDepartment(new NextRequest(request.url, { method: 'PATCH', headers: request.headers, body: JSON.stringify({ ...body, id }) }));
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Organisation unit not found.' }, { status: 404 });
    }
    const db = getDb();
    const [existing] = await db.select().from(departments).where(and(eq(departments.id, id), eq(departments.tenantId, auth.session.tenantId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Organisation unit not found.' }, { status: 404 });
    const [staff, assignments, officeLink, requestRef, workflow, child] = await Promise.all([
      db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, auth.session.tenantId), eq(employees.departmentId, id))).limit(1),
      db.select({ id: employeeAssignments.id }).from(employeeAssignments).where(and(eq(employeeAssignments.tenantId, auth.session.tenantId), eq(employeeAssignments.departmentId, id))).limit(1),
      db.select({ id: departmentOffices.id }).from(departmentOffices).where(and(eq(departmentOffices.tenantId, auth.session.tenantId), eq(departmentOffices.departmentId, id))).limit(1),
      db.select({ id: transportRequests.id }).from(transportRequests).where(and(eq(transportRequests.tenantId, auth.session.tenantId), eq(transportRequests.departmentId, id))).limit(1),
      db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(eq(workflowDefinitions.tenantId, auth.session.tenantId), eq(workflowDefinitions.departmentId, id))).limit(1),
      db.select({ id: departments.id }).from(departments).where(and(eq(departments.tenantId, auth.session.tenantId), eq(departments.parentId, id))).limit(1),
    ]);
    const referenced = [staff, assignments, officeLink, requestRef, workflow, child].some((rows) => rows.length > 0);
    if (referenced) {
      const [archived] = await db.update(departments).set({ isActive: false, archivedAt: existing.archivedAt ?? new Date(), updatedAt: new Date() }).where(and(eq(departments.id, id), eq(departments.tenantId, auth.session.tenantId))).returning();
      await recordAuditEvent({ tenantId: auth.session.tenantId, actorUserId: auth.session.user.id, action: 'department.archived', entityType: 'department', entityId: id, before: existing, after: archived, summary: `Archived referenced organisation unit ${existing.name}` });
      return NextResponse.json({ success: true, archived: true, message: 'This organisation unit is referenced by staff, offices, workflow or historical records. It was archived instead of permanently deleted.' });
    }
    await db.delete(departments).where(and(eq(departments.id, id), eq(departments.tenantId, auth.session.tenantId)));
    await recordAuditEvent({ tenantId: auth.session.tenantId, actorUserId: auth.session.user.id, action: 'department.deleted', entityType: 'department', entityId: id, before: existing, summary: `Permanently deleted unused organisation unit ${existing.name}` });
    return NextResponse.json({ success: true, archived: false });
  } catch (error) {
    console.error('[Department Detail] DELETE failed:', error);
    return NextResponse.json({ error: 'The organisation unit could not be deleted safely.' }, { status: 500 });
  }
}
