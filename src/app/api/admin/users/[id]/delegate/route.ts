/**
 * Delegation API
 *
 * POST   /api/admin/users/[id]/delegate — Assign one of the source user's
 *         permanent roles to another active tenant user temporarily.
 * DELETE /api/admin/users/[id]/delegate — End or cancel an acting assignment.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { tenantMemberships, roleAssignments, roles } from '@/db/schema/tenants';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asDate(value: Date | string | null | undefined) {
  return value ? new Date(value) : null;
}

function assignmentCoversWindow(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  startsAt: Date,
  endsAt: Date | null,
) {
  const assignmentStart = asDate(assignment.startDate);
  const assignmentEnd = asDate(assignment.endDate);
  if (assignmentStart && assignmentStart > startsAt) return false;
  if (!endsAt) return assignmentEnd === null;
  return assignmentEnd === null || assignmentEnd >= endsAt;
}

function assignmentOverlapsWindow(
  assignment: { startDate: Date | string | null; endDate: Date | string | null },
  startsAt: Date,
  endsAt: Date | null,
) {
  const assignmentStart = asDate(assignment.startDate);
  const assignmentEnd = asDate(assignment.endDate);
  const existingStartsBeforeNewEnds = endsAt === null || assignmentStart === null || assignmentStart < endsAt;
  const newStartsBeforeExistingEnds = assignmentEnd === null || startsAt < assignmentEnd;
  return existingStartsBeforeNewEnds && newStartsBeforeExistingEnds;
}

function assignmentEndRevisionMatches(endDate: Date | string | null | undefined) {
  const reviewedEnd = asDate(endDate);
  return reviewedEnd
    ? sql`date_trunc('milliseconds', ${roleAssignments.endDate}) = ${reviewedEnd.toISOString()}::timestamptz`
    : isNull(roleAssignments.endDate);
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
    const targetUserId = typeof body?.targetUserId === 'string' ? body.targetUserId : '';
    const roleId = typeof body?.roleId === 'string' ? body.roleId : '';
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim() : null;
    if (!targetUserId || !roleId) {
      return NextResponse.json({ error: 'Target user and role are required' }, { status: 400 });
    }
    if (targetUserId === id) {
      return NextResponse.json({ error: 'A role cannot be delegated back to the same user' }, { status: 422 });
    }

    const startsAt = body?.startDate ? new Date(body.startDate) : new Date();
    const endsAt = body?.endDate ? new Date(body.endDate) : null;
    if (Number.isNaN(startsAt.getTime()) || (endsAt && Number.isNaN(endsAt.getTime()))) {
      return NextResponse.json({ error: 'Delegation dates are invalid' }, { status: 422 });
    }
    if (endsAt && endsAt <= startsAt) {
      return NextResponse.json({ error: 'Delegation end date must be after its start date' }, { status: 422 });
    }
    if (!UUID_PATTERN.test(roleId)) {
      return NextResponse.json({ error: 'Role not found in your organisation' }, { status: 404 });
    }

    const db = getDb();
    const [[sourceMembership], [targetMembership], [role]] = await Promise.all([
      db
        .select()
        .from(tenantMemberships)
        .where(and(
          eq(tenantMemberships.userId, id),
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(tenantMemberships.status, 'active'),
        ))
        .limit(1),
      db
        .select()
        .from(tenantMemberships)
        .where(and(
          eq(tenantMemberships.userId, targetUserId),
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(tenantMemberships.status, 'active'),
        ))
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

    const sourceRoleHistory = await db
      .select({
        id: roleAssignments.id,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
        isActing: roleAssignments.isActing,
      })
      .from(roleAssignments)
      .where(and(
        eq(roleAssignments.tenantMembershipId, sourceMembership.id),
        eq(roleAssignments.roleId, roleId),
      ));

    const sourceRole = sourceRoleHistory.find(
      (assignment) => !assignment.isActing && assignmentCoversWindow(assignment, startsAt, endsAt),
    );
    if (!sourceRole) {
      return NextResponse.json(
        {
          error: endsAt
            ? 'The source user must hold this permanent role for the entire delegation period'
            : 'An open-ended delegation requires the source user to hold this permanent role without an end date',
        },
        { status: 409 },
      );
    }

    const targetRoleHistory = await db
      .select({
        id: roleAssignments.id,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
        isActing: roleAssignments.isActing,
      })
      .from(roleAssignments)
      .where(and(
        eq(roleAssignments.tenantMembershipId, targetMembership.id),
        eq(roleAssignments.roleId, roleId),
      ));
    if (targetRoleHistory.some((assignment) => assignmentOverlapsWindow(assignment, startsAt, endsAt))) {
      return NextResponse.json(
        { error: 'The target user already holds this role during part or all of the requested delegation period' },
        { status: 409 },
      );
    }

    const [[actorUser], [targetUser]] = await Promise.all([
      db.select({ name: user.name }).from(user).where(eq(user.id, session.user.id)).limit(1),
      db.select({ name: user.name }).from(user).where(eq(user.id, targetUserId)).limit(1),
    ]);

    const assignment = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(roleAssignments)
        .values({
          tenantMembershipId: targetMembership.id,
          roleId,
          startDate: startsAt,
          endDate: endsAt,
          isActing: true,
          delegatedByUserId: id,
          reason,
        })
        .returning();

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        eventType: 'staff',
        action: 'Acting role assigned',
        entityType: 'role_assignment',
        entityId: created.id,
        after: {
          sourceUserId: id,
          targetUserId,
          roleId,
          roleName: role.name,
          startsAt,
          endsAt,
          reason,
        },
        summary: `${actorUser?.name || 'Administrator'} delegated role "${role.name}" to ${targetUser?.name || 'tenant user'}${reason ? ` — ${reason}` : ''}`,
        isActing: true,
      }, tx);

      return created;
    });

    return NextResponse.json({ success: true, data: assignment });
  } catch (error) {
    console.error('[Delegation] POST failed:', error);
    return NextResponse.json({ error: 'Failed to create delegation' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const assignmentId = new URL(request.url).searchParams.get('assignmentId');
    if (!assignmentId) {
      return NextResponse.json({ error: 'assignmentId query param is required' }, { status: 400 });
    }
    if (!UUID_PATTERN.test(assignmentId)) {
      return NextResponse.json({ error: 'Acting assignment not found' }, { status: 404 });
    }

    const db = getDb();
    const [assignment] = await db
      .select({
        id: roleAssignments.id,
        roleId: roleAssignments.roleId,
        tenantMembershipId: roleAssignments.tenantMembershipId,
        startDate: roleAssignments.startDate,
        endDate: roleAssignments.endDate,
      })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.id, assignmentId), eq(roleAssignments.isActing, true)))
      .limit(1);
    if (!assignment) {
      return NextResponse.json({ error: 'Acting assignment not found' }, { status: 404 });
    }

    const [membership] = await db
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .where(and(
        eq(tenantMemberships.id, assignment.tenantMembershipId),
        eq(tenantMemberships.tenantId, session.tenantId),
      ))
      .limit(1);
    if (!membership) {
      return NextResponse.json({ error: 'Assignment not found in your organisation' }, { status: 404 });
    }

    const now = new Date();
    const previousEnd = asDate(assignment.endDate);
    if (previousEnd && previousEnd <= now) {
      return NextResponse.json({ success: true, alreadyEnded: true });
    }

    const startsAt = asDate(assignment.startDate);
    const endedAt = startsAt && startsAt > now ? startsAt : now;
    const wasScheduled = Boolean(startsAt && startsAt > now);

    const committed = await db.transaction(async (tx) => {
      const [ended] = await tx
        .update(roleAssignments)
        .set({ endDate: endedAt })
        .where(and(
          eq(roleAssignments.id, assignmentId),
          eq(roleAssignments.tenantMembershipId, membership.id),
          eq(roleAssignments.isActing, true),
          assignmentEndRevisionMatches(assignment.endDate),
        ))
        .returning({ id: roleAssignments.id });
      if (!ended) return false;

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        eventType: 'staff',
        action: wasScheduled ? 'Acting assignment cancelled' : 'Acting assignment ended',
        entityType: 'role_assignment',
        entityId: assignmentId,
        before: {
          startDate: assignment.startDate,
          endDate: assignment.endDate,
        },
        after: { endDate: endedAt },
        summary: wasScheduled
          ? 'Scheduled acting role assignment cancelled before it began; history preserved'
          : 'Acting role assignment ended by administrator; history preserved',
        isActing: true,
      }, tx);
      return true;
    });

    if (!committed) {
      return NextResponse.json(
        { error: 'This acting assignment changed while the end action was being prepared. Refresh User Management and review the current delegation state.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Delegation] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to end delegation' }, { status: 500 });
  }
}
