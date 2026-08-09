import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { programmes } from '@/db/schema/programmes';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';
import {
  isProgrammeOwnedByUser,
  resolveProgrammeAccess,
} from '@/lib/programme-access';

/**
 * Programme workflow action API
 *
 * Programme review is intentionally separate from the transport-request
 * approval chain. Personal-workspace users may submit only programmes they
 * own; Tenant Administrators may operate tenant-wide, subject to separation
 * of duty for review decisions.
 */
type Action =
  | 'submit'
  | 'request_changes'
  | 'approve'
  | 'reject'
  | 'publish'
  | 'archive'
  | 'complete';

type PermissionsKey = (typeof Permissions)[keyof typeof Permissions];

const VALID_TRANSITIONS: Record<string, readonly Action[]> = {
  draft: ['submit', 'archive'],
  changes_requested: ['submit', 'archive'],
  submitted: ['request_changes', 'approve', 'reject'],
  approved: ['publish', 'archive'],
  published: ['complete', 'archive'],
  completed: ['archive'],
  rejected: [],
  archived: [],
};

const TITLE_BY_ACTION: Record<Action, string> = {
  submit: 'Programme submitted for review',
  request_changes: 'Changes requested on your programme',
  approve: 'Programme approved',
  reject: 'Programme rejected',
  publish: 'Programme published',
  archive: 'Programme archived',
  complete: 'Programme marked completed',
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const body = await request.json();
    const action = body?.action as Action;
    const note = typeof body?.note === 'string' ? body.note.trim() : '';
    const validActions: readonly Action[] = [
      'submit',
      'request_changes',
      'approve',
      'reject',
      'publish',
      'archive',
      'complete',
    ];
    if (!validActions.includes(action)) {
      return NextResponse.json({ error: `Invalid programme action: ${String(action)}` }, { status: 400 });
    }

    const db = getDb();
    const tenantId = session.tenantId;
    const userId = session.user.id;
    const [programme] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!programme) return NextResponse.json({ error: 'Programme not found' }, { status: 404 });

    const allowed = VALID_TRANSITIONS[programme.status] ?? [];
    if (!allowed.includes(action)) {
      return NextResponse.json(
        { error: `Cannot ${action.replace(/_/g, ' ')} a programme with status "${programme.status}".` },
        { status: 409 },
      );
    }

    const permissionForAction: Partial<Record<Action, PermissionsKey>> = {
      submit: Permissions.PROGRAMME_SUBMIT,
      request_changes: Permissions.PROGRAMME_REVIEW,
      approve: Permissions.PROGRAMME_APPROVE,
      reject: Permissions.PROGRAMME_REJECT,
      publish: Permissions.PROGRAMME_PUBLISH,
      archive: Permissions.PROGRAMME_ARCHIVE,
      complete: Permissions.PROGRAMME_PUBLISH,
    };
    const requiredPermission = permissionForAction[action];
    if (!requiredPermission) {
      return NextResponse.json({ error: 'Programme action is not permitted' }, { status: 403 });
    }
    const permCheck = await requirePermission(session, requiredPermission);
    if (permCheck instanceof NextResponse) return permCheck;

    const access = await resolveProgrammeAccess(session);
    const isOwner = isProgrammeOwnedByUser(programme, userId, access.employeeId);

    if (action === 'submit' && !isOwner) {
      // A requester must never be able to advance another requester's draft by
      // guessing an ID. Tenant-wide programme managers retain that capability.
      const editAnyCheck = await requirePermission(session, Permissions.PROGRAMME_EDIT_ANY);
      if (editAnyCheck instanceof NextResponse) {
        return NextResponse.json({ error: 'You may only submit programmes that you own' }, { status: 403 });
      }
    }

    if (['request_changes', 'approve', 'reject'].includes(action) && isOwner) {
      return NextResponse.json(
        { error: 'You cannot review or decide a programme that you own. Another authorised Tenant Administrator must perform the review.' },
        { status: 409 },
      );
    }

    if (['request_changes', 'reject'].includes(action) && !note) {
      return NextResponse.json(
        { error: action === 'request_changes' ? 'A note is required when requesting changes.' : 'A rejection reason is required.' },
        { status: 400 },
      );
    }

    const now = new Date();
    const patch: Record<string, unknown> = { updatedAt: now };
    let nextStatus: string;
    switch (action) {
      case 'submit':
        nextStatus = 'submitted';
        patch.submittedAt = now;
        patch.reviewNotes = null;
        patch.rejectionReason = null;
        break;
      case 'request_changes':
        nextStatus = 'changes_requested';
        patch.reviewNotes = note;
        patch.reviewedByUserId = userId;
        patch.reviewedAt = now;
        break;
      case 'approve':
        nextStatus = 'approved';
        patch.approvedByUserId = userId;
        patch.approvedAt = now;
        patch.reviewNotes = note || programme.reviewNotes;
        break;
      case 'reject':
        nextStatus = 'rejected';
        patch.rejectionReason = note;
        patch.reviewedByUserId = userId;
        patch.reviewedAt = now;
        break;
      case 'publish':
        nextStatus = 'published';
        patch.publishedByUserId = userId;
        patch.publishedAt = now;
        patch.approvedByUserId = programme.approvedByUserId ?? userId;
        patch.approvedAt = programme.approvedAt ?? now;
        break;
      case 'archive':
        nextStatus = 'archived';
        patch.archivedAt = now;
        break;
      case 'complete':
        nextStatus = 'completed';
        patch.completedAt = now;
        break;
      default:
        return NextResponse.json({ error: 'Invalid programme action' }, { status: 400 });
    }

    const [updated] = await db
      .update(programmes)
      .set({ ...patch, status: nextStatus })
      .where(and(
        eq(programmes.id, id),
        eq(programmes.tenantId, tenantId),
        eq(programmes.status, programme.status),
      ))
      .returning();
    if (!updated) {
      return NextResponse.json(
        { error: 'This programme changed while you were reviewing it. Refresh and review the latest status before deciding.' },
        { status: 409 },
      );
    }

    await recordAuditEvent({
      tenantId,
      actorUserId: userId,
      action: `programme.${action}`,
      entityType: 'programme',
      entityId: id,
      sourceChannel: 'web',
      before: { status: programme.status },
      after: { status: nextStatus },
      reason: note || undefined,
      summary: `Programme ${programme.reference} ${action.replace(/_/g, ' ')} (${programme.status} → ${nextStatus})`,
    });

    try {
      const statusLabel = nextStatus.replace(/_/g, ' ');
      const notificationBody = `${programme.title} (${programme.reference}) is now ${statusLabel}.`;
      if (action === 'submit') {
        const reviewers = await resolveActiveRoleRecipients(tenantId, [SystemRoles.TENANT_ADMIN]);
        const recipients = reviewers.filter((recipientUserId) => recipientUserId !== userId);
        if (recipients.length > 0) {
          await createScopedNotifications({
            tenantId,
            recipientUserIds: recipients,
            category: 'action_required',
            eventType: 'programme_submit',
            title: TITLE_BY_ACTION.submit,
            body: notificationBody,
            entityType: 'programme',
            entityId: id,
            actionUrl: `/dashboard/programmes/${id}`,
            workspace: WorkspaceIds.TENANT_ADMIN,
            requiredRole: null,
          });
        }
      } else {
        const recipientUserId = programme.ownerUserId || programme.createdByUserId;
        if (recipientUserId) {
          await createScopedNotifications({
            tenantId,
            recipientUserIds: [recipientUserId],
            category: action === 'reject' || action === 'request_changes' ? 'action_required' : 'outcome',
            eventType: `programme_${action}`,
            title: TITLE_BY_ACTION[action],
            body: notificationBody,
            entityType: 'programme',
            entityId: id,
            actionUrl: `/dashboard/programmes/${id}`,
            workspace: null,
            requiredRole: null,
          });
        }
      }
    } catch (notificationError) {
      console.warn('[Programmes] notification delivery failed:', notificationError);
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Programmes] action failed:', error);
    return NextResponse.json({ error: 'Failed to process programme action' }, { status: 500 });
  }
}
