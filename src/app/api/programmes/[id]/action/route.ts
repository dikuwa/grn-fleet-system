import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { programmes } from '@/db/schema/programmes';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

/**
 * Programme workflow action API
 *
 * POST /api/programmes/[id]/action  { action, note? }
 *
 * Actions: submit | request_changes | approve | reject | publish | archive | complete
 *
 * State machine (server-enforced):
 *   draft / changes_requested --submit--> submitted
 *   submitted --request_changes--> changes_requested
 *   submitted --approve--> approved
 *   submitted --reject--> rejected
 *   approved  --publish--> published
 *   published --complete--> completed
 *   approved/published/completed --archive--> archived
 *   draft --archive--> archived
 *
 * A submitted Programme goes to the Tenant Administrator (or configured
 * Programme reviewer) — it does NOT enter the transport request chain.
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

const EDITABLE_DRAFT_ACTIONS: readonly Action[] = ['submit'];

const VALID_TRANSITIONS: Record<string, readonly Action[]> = {
  draft: [...EDITABLE_DRAFT_ACTIONS, 'archive'],
  changes_requested: [...EDITABLE_DRAFT_ACTIONS, 'archive'],
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
      return NextResponse.json(
        { error: `Invalid programme action: ${String(action)}` },
        { status: 400 },
      );
    }

    const db = getDb();
    const tenantId = session.tenantId;
    const userId = session.user.id;

    const [programme] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!programme) {
      return NextResponse.json({ error: 'Programme not found' }, { status: 404 });
    }

    const allowed = VALID_TRANSITIONS[programme.status] ?? [];
    if (!allowed.includes(action)) {
      return NextResponse.json(
        {
          error: `Cannot ${action.replace(/_/g, ' ')} a programme with status "${programme.status}".`,
        },
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

    if (
      ['request_changes', 'approve', 'reject'].includes(action) &&
      programme.createdByUserId === userId
    ) {
      const tenantAdminCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
      if (tenantAdminCheck instanceof NextResponse) {
        return NextResponse.json(
          { error: 'You cannot review or approve your own programme.' },
          { status: 409 },
        );
      }
    }

    if (['request_changes', 'reject'].includes(action) && !note) {
      return NextResponse.json(
        {
          error:
            action === 'request_changes'
              ? 'A note is required when requesting changes.'
              : 'A rejection reason is required.',
        },
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
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .returning();

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

    // Notifications are intentionally split by recipient context. A submission
    // belongs to the Tenant Admin workspace; an outcome belongs to the creator
    // and must remain visible regardless of which tenant workspace they use.
    try {
      const statusLabel = nextStatus.replace(/_/g, ' ');
      const notificationBody = `${programme.title} (${programme.reference}) is now ${statusLabel}.`;

      if (action === 'submit') {
        const reviewers = await resolveActiveRoleRecipients(tenantId, [SystemRoles.TENANT_ADMIN]);
        if (reviewers.length > 0) {
          await createScopedNotifications({
            tenantId,
            recipientUserIds: reviewers,
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
        const creatorUserId = programme.createdByUserId || programme.ownerUserId;
        if (creatorUserId) {
          await createScopedNotifications({
            tenantId,
            recipientUserIds: [creatorUserId],
            category:
              action === 'reject' || action === 'request_changes'
                ? 'action_required'
                : 'outcome',
            eventType: `programme_${action}`,
            title: TITLE_BY_ACTION[action],
            body: notificationBody,
            entityType: 'programme',
            entityId: id,
            actionUrl: `/dashboard/programmes/${id}`,
            // Creator outcomes are personal. Keep workspace null so a requester
            // does not lose the notification because it was tagged tenant_admin.
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
