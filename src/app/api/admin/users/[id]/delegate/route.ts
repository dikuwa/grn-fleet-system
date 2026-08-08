/**
 * Delegation API
 *
 * POST   /api/admin/users/[id]/delegate — Assign one of the source user's
 *         active permanent roles to another active tenant user temporarily.
 * DELETE /api/admin/users/[id]/delegate — End an acting assignment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { auditEvents } from '@/db/schema/audit';
import { eq, and, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

function assignmentIsActive(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  now = new Date(),
) {
  const startsAt = assignment.startDate ? new Date(assignment.startDate) : null;
  const endsAt = assignment.endDate ? new Date(assignment.endDate) : null;
  return (!startsAt || startsAt <= now) && (!endsAt || endsAt > now);
}

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
      return NextResponse.json({ error: 'Target user and role are required' }, { status: 400 });
    }
    if (targetUserId === id) {
      return NextResponse.json({ error: 'A role cannot be delegated back to the same user' }, { status: 422 });
    }

    const startsAt = startDate ? new Date(startDate) : new Date();
    const endsAt = endDate ? new Date(endDate) : null;
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      return NextResponse.json({ error: 'Delegation dates are invalid' }, { status: 422 });
    }
    if (endsAt && endsAt <= startsAt) {
      return NextResponse.json({ error: 'Delegation end date must be after its start date' }, { status: 422 });
    }

    const db = getDb();
    const [[sourceMembership], [targetMembership], [role]] = await Promise.all([
      db
        .select()
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.userId, id),
            eq(tenantMemberships.tenantId, session.tenantId),
            eq(tenantMemberships.status, 'active'),
          ),
        )
        .limit(1),
      db
        .select()
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.userId, targetUserId),
            eq(tenantMemberships.tenantId, session.tenantId),
            eq(tenantMemberships.status, 'active'),
          ),
        )
        .limit(1),
      db
        .select()
        .from(roles)
        .where(and(eq(roles.id, roleId), eq(roles.tenantId, session.tenantId)))
        .limit(1),
    ]);

    if (!sourceMembership) {
      return NextResponse.json({ error: 'Source user is not an active member of this organisation' }, { status: 404 });
    }
    if (!targetMembership) {
      return NextResponse.json({ error: 'Delegation target must be an active tenant user' }, { status: 422 });
    }
    if (!role) {
      return NextResponse.json({ error: 'Role not found in your organisation' }, { status: 404 });
    }

    const now = new Date();
    const sourceRoleHistory = await db
      .select({
        id: roleAssignments.id,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
        isActing: roleAssignments.isActing,
      })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.tenantMembershipId, sourceMembership.id),
          eq(roleAssignments.roleId, roleId),
        ),
      );

    const sourceHoldsPermanentRole = sourceRoleHistory.some(
      (assignment) => !assignment.isActing && assignmentIsActive(assignment, now),
    );
    if (!sourceHoldsPermanentRole) {
      return NextResponse.json(
        { error: 'Only a currently active permanent role held by the source user can be delegated' },
        { status: 409 },
      );
    }

    const targetRoleHistory = await db
      .select({
        id: roleAssignments.id,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
      })
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.tenantMembershipId, targetMembership.id),
          eq(roleAssignments.roleId, roleId),
        ),
      );
    if (targetRoleHistory.some((assignment) => assignmentIsActive(assignment, now))) {
      return NextResponse.json(
        { error: 'The target user already holds this role through an active assignment' },
        { status: 409 },
      );
    }

    const [assignment] = await db
      .insert(roleAssignments)
      .values({
        tenantMembershipId: targetMembership.id,
        roleId,
        startDate: startsAt,
        endDate: endsAt,
        isActing: true,
        delegatedByUserId: id,
        reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
      })
      .returning();

    try {
      const [[actorUser], [targetUser], [nextSeq]] = await Promise.all([
        db.select({ name: user.name }).from(user).where(eq(user.id, session.user.id)).limit(1),
        db.select({ name: user.name }).from(user).where(eq(user.id, targetUserId)).limit(1),
        db
          .select({ seq: sql<number>`COALESCE(MAX(tenant_sequence), 0) + 1` })
          .from(auditEvents)
          .where(eq(auditEvents.tenantId, session.tenantId)),
      ]);

      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: nextSeq.seq,
        eventType: 'staff',
        actorUserId: session.user.id,
        action: 'Acting role assigned',
        entityType: 'role_assignment',
        entityId: assignment.id,
        summary: `${actorUser?.name || 'Unknown'} delegated role "${role.name}" to ${targetUser?.name || 'Unknown user'}${reason ? ` — ${String(reason).trim()}` : ''}`,
        isActing: true,
      });
    } catch {
      // Audit logging is best-effort; the role assignment remains the source record.
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
    const [assignment] = await db
      .select({
        id: roleAssignments.id,
        roleId: roleAssignments.roleId,
        tenantMembershipId: roleAssignments.tenantMembershipId,
      })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.isActing, true)))
      .limit(1);
    if (!assignment) {
      return NextResponse.json({ error: 'Acting assignment not found' }, { status: 404 });
    }

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

    // This legacy acting-assignment endpoint predates the dedicated delegation
    // ledger. Ending rather than deleting preserves role history for audits.
    await db
      .update(roleAssignments)
      .set({ endDate: new Date() })
      .where(eq(roleAssignments.id, assignmentId));

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
        action: 'Acting assignment ended',
        entityType: 'role_assignment',
        entityId: assignmentId,
        summary: 'Acting role assignment ended by administrator; history preserved',
      });
    } catch {
      // Audit logging is best-effort.
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Delegation] DELETE failed:', error);
    return NextResponse.json(
      { error: 'Failed to end delegation: ' + String(error) },
      { status: 500 },
    );
  }
}
