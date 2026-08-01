/**
 * Delegation API
 *
 * POST   /api/admin/users/[id]/delegate    — Assign acting role to another user
 * DELETE /api/admin/users/[id]/delegate    — Remove an acting assignment
 *
 * Allows an administrator to temporarily delegate a role to another user
 * with optional start/end dates and a reason.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

// ---------------------------------------------------------------------------
// POST — Create acting assignment
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { targetUserId, roleId, startDate, endDate, reason } = body;

    if (!targetUserId || !roleId) {
      return NextResponse.json({ error: 'targetUserId and roleId are required' }, { status: 400 });
    }

    const db = getDb();

    // Verify the source user (id) belongs to this tenant
    const [sourceMembership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!sourceMembership) {
      return NextResponse.json({ error: 'Source user not found in your organisation' }, { status: 404 });
    }

    // Verify the target user belongs to this tenant
    const [targetMembership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.userId, targetUserId), eq(tenantMemberships.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!targetMembership) {
      return NextResponse.json({ error: 'Target user not found in your organisation' }, { status: 404 });
    }

    // Verify the role exists in this tenant
    const [role] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId)))
      .limit(1);

    if (!role) {
      return NextResponse.json({ error: 'Role not found in your organisation' }, { status: 404 });
    }

    // Create acting assignment
    const [assignment] = await db
      .insert(roleAssignments)
      .values({
        tenantMembershipId: targetMembership.id,
        roleId,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        isActing: true,
        delegatedByUserId: id,
        reason: reason || null,
      })
      .returning();

    // Audit log
    try {
      const [actorUser] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1);

      const [targetUser] = await db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, targetUserId))
        .limit(1);

      const [nextSeq] = await db
        .select({ seq: sql<number>`COALESCE(MAX(tenant_sequence), 0) + 1` })
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, session.tenantId));

      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: nextSeq.seq,
        eventType: 'staff',
        actorUserId: session.user.id,
        action: 'Acting role assigned',
        entityType: 'role_assignment',
        entityId: assignment.id,
        summary: `${actorUser?.name || 'Unknown'} delegated role "${role.name}" to ${targetUser?.name || 'Unknown user'}${reason ? ` — ${reason}` : ''}`,
        isActing: true,
      });
    } catch {
      // Audit logging is best-effort
    }

    return NextResponse.json({ success: true, data: assignment });
  } catch (error) {
    console.error('[Delegation] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to create delegation: ' + String(error) },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — Remove an acting assignment
// ---------------------------------------------------------------------------

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const assignmentId = searchParams.get('assignmentId');

    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId query param is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify the assignment exists and is an acting assignment
    const [assignment] = await db
      .select({
        id: roleAssignments.id,
        roleId: roleAssignments.roleId,
        tenantMembershipId: roleAssignments.tenantMembershipId,
      })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.id, assignmentId),
          eq(roleAssignments.isActing, true),
        ),
      )
      .limit(1);

    if (!assignment) {
      return NextResponse.json({ error: 'Acting assignment not found' }, { status: 404 });
    }

    // Verify this assignment is within the same tenant
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.id, assignment.tenantMembershipId),
          eq(tenantMemberships.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'Assignment not found in your organisation' }, { status: 404 });
    }

    await db.delete(roleAssignments).where(eq(roleAssignments.id, assignmentId));

    // Audit log
    try {
      const [nextSeq] = await db
        .select({ seq: sql<number>`COALESCE(MAX(tenant_sequence), 0) + 1` })
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, session.tenantId));

      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: nextSeq.seq,
        eventType: 'staff',
        actorUserId: session.user.id,
        action: 'Acting assignment removed',
        entityType: 'role_assignment',
        summary: 'Acting role assignment removed by administrator',
      });
    } catch {
      // Best-effort
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Delegation] DELETE failed:', error);
    return NextResponse.json(
      { error: 'Failed to remove delegation: ' + String(error) },
      { status: 500 },
    );
  }
}
