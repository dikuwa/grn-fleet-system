import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { departmentOffices, employeeAssignments, employees, offices, transportRequests, vehicles, workflowDefinitions } from '@/db/schema';
import { eq, and, or } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import { PATCH as patchOffice } from '../route';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  return patchOffice(new NextRequest(request.url, { method: 'PATCH', headers: request.headers, body: JSON.stringify({ ...body, id }) }));
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    const db = getDb();
    const [existing] = await db.select().from(offices).where(and(eq(offices.id, id), eq(offices.tenantId, auth.session.tenantId))).limit(1);
    if (!existing) return NextResponse.json({ error: 'Office not found.' }, { status: 404 });
    const [staff, assignments, departmentLink, vehicle, requestRef, workflow, child] = await Promise.all([
      db.select({ id: employees.id }).from(employees).where(and(eq(employees.tenantId, auth.session.tenantId), eq(employees.officeId, id))).limit(1),
      db.select({ id: employeeAssignments.id }).from(employeeAssignments).where(and(eq(employeeAssignments.tenantId, auth.session.tenantId), eq(employeeAssignments.officeId, id))).limit(1),
      db.select({ id: departmentOffices.id }).from(departmentOffices).where(and(eq(departmentOffices.tenantId, auth.session.tenantId), eq(departmentOffices.officeId, id))).limit(1),
      db.select({ id: vehicles.id }).from(vehicles).where(and(eq(vehicles.tenantId, auth.session.tenantId), eq(vehicles.officeId, id))).limit(1),
      db.select({ id: transportRequests.id }).from(transportRequests).where(and(eq(transportRequests.tenantId, auth.session.tenantId), or(eq(transportRequests.officeId, id), eq(transportRequests.approvalOfficeId, id)))).limit(1),
      db.select({ id: workflowDefinitions.id }).from(workflowDefinitions).where(and(eq(workflowDefinitions.tenantId, auth.session.tenantId), eq(workflowDefinitions.officeId, id))).limit(1),
      db.select({ id: offices.id }).from(offices).where(and(eq(offices.tenantId, auth.session.tenantId), eq(offices.parentId, id))).limit(1),
    ]);
    const referenced = [staff, assignments, departmentLink, vehicle, requestRef, workflow, child].some((rows) => rows.length > 0);
    if (referenced) {
      const [archived] = await db.update(offices).set({ isActive: false, archivedAt: existing.archivedAt ?? new Date(), updatedAt: new Date() }).where(and(eq(offices.id, id), eq(offices.tenantId, auth.session.tenantId))).returning();
      await recordAuditEvent({ tenantId: auth.session.tenantId, actorUserId: auth.session.user.id, action: 'office.archived', entityType: 'office', entityId: id, before: existing, after: archived, summary: `Archived referenced office ${existing.name}` });
      return NextResponse.json({ success: true, archived: true, message: 'This office is already used by staff, vehicles, requests or historical records. It was archived instead of permanently deleted.' });
    }
    await db.delete(offices).where(and(eq(offices.id, id), eq(offices.tenantId, auth.session.tenantId)));
    await recordAuditEvent({ tenantId: auth.session.tenantId, actorUserId: auth.session.user.id, action: 'office.deleted', entityType: 'office', entityId: id, before: existing, summary: `Permanently deleted unused office ${existing.name}` });
    return NextResponse.json({ success: true, archived: false });
  } catch (error) {
    console.error('[Office Detail] DELETE failed:', error);
    return NextResponse.json({ error: 'The office could not be deleted safely.' }, { status: 500 });
  }
}
