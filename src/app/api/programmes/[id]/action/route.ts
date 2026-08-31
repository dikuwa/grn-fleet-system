import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { programmes } from '@/db/schema/programmes';
import { employees } from '@/db/schema/people';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { eq, and, sql, type SQL } from 'drizzle-orm';
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

    // Never move a Programme into a review state that nobody can action.
    // The reviewer must be an active Tenant Administrator other than the
    // submitting user so the same separation-of-duty rule enforced on the
    // decision endpoint is satisfiable after submission.
    let submitReviewers: string[] | null = null;
    if (action === 'submit') {
      const reviewers = await resolveActiveRoleRecipients(tenantId, [SystemRoles.TENANT_ADMIN]);
      submitReviewers = reviewers.filter((recipientUserId) => recipientUserId !== userId);
      if (submitReviewers.length === 0) {
        return NextResponse.json(
          {
            error:
              'This programme cannot be submitted yet because no independent Tenant Administrator is available to review it. Assign another active Tenant Administrator or transfer programme ownership before submitting.',
          },
          { status: 409 },
        );
      }
    }

    // These timestamps are interpolated into an untyped raw SQL fragment below.
    // Normalize them first so the postgres.js driver never receives a raw Date
    // object on this path (which is not a column-bound Drizzle parameter).
    const nowIso = new Date().toISOString();
    let nextStatus: string;
    let transitionSet: SQL;
    switch (action) {
      case 'submit':
        nextStatus = 'submitted';
        transitionSet = sql`status = 'submitted', submitted_at = ${nowIso}::timestamptz, review_notes = NULL, rejection_reason = NULL, updated_at = ${nowIso}::timestamptz`;
        break;
      case 'request_changes':
        nextStatus = 'changes_requested';
        transitionSet = sql`status = 'changes_requested', review_notes = ${note}, reviewed_by_user_id = ${userId}, reviewed_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz`;
        break;
      case 'approve':
        nextStatus = 'approved';
        transitionSet = sql`status = 'approved', approved_by_user_id = ${userId}, approved_at = ${nowIso}::timestamptz, review_notes = ${note || programme.reviewNotes}, updated_at = ${nowIso}::timestamptz`;
        break;
      case 'reject':
        nextStatus = 'rejected';
        transitionSet = sql`status = 'rejected', rejection_reason = ${note}, reviewed_by_user_id = ${userId}, reviewed_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz`;
        break;
      case 'publish':
        nextStatus = 'published';
        transitionSet = sql`status = 'published', published_by_user_id = ${userId}, published_at = ${nowIso}::timestamptz, approved_by_user_id = COALESCE(approved_by_user_id, ${userId}), approved_at = COALESCE(approved_at, ${nowIso}::timestamptz), updated_at = ${nowIso}::timestamptz`;
        break;
      case 'archive':
        nextStatus = 'archived';
        transitionSet = sql`status = 'archived', archived_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz`;
        break;
      case 'complete':
        nextStatus = 'completed';
        transitionSet = sql`status = 'completed', completed_at = ${nowIso}::timestamptz, updated_at = ${nowIso}::timestamptz`;
        break;
      default:
        return NextResponse.json({ error: 'Invalid programme action' }, { status: 400 });
    }

    const auditSequence = Date.now();
    const summary = `Programme ${programme.reference} ${action.replace(/_/g, ' ')} (${programme.status} → ${nextStatus})`;

    // Claim exactly the expected state first. Immutable audit evidence is
    // inserted only from that claim, so stale/concurrent actions can create
    // neither a state transition nor a false audit event.
    await db.execute(sql`
      WITH programme_claim AS (
        UPDATE programmes
        SET ${transitionSet}
        WHERE id = ${id}::uuid
          AND tenant_id = ${tenantId}::uuid
          AND status = ${programme.status}
        RETURNING id
      ),
      audit_insert AS (
        INSERT INTO audit_events (
          tenant_id, tenant_sequence, event_type, actor_user_id,
          action, entity_type, entity_id, source_channel,
          before, after, reason, summary
        )
        SELECT
          ${tenantId}::uuid,
          ${auditSequence},
          ${`programme_${action}`},
          ${userId},
          ${`programme.${action}`},
          'programme',
          ${id}::uuid,
          'web',
          jsonb_build_object('status', ${programme.status}::text),
          jsonb_build_object('status', ${nextStatus}::text),
          ${note || null}::text,
          ${summary}
        FROM programme_claim
        RETURNING id
      )
      SELECT CAST(CASE
        WHEN (SELECT count(*) FROM programme_claim) = 1
         AND (SELECT count(*) FROM audit_insert) = 1
        THEN '1'
        ELSE 'atomic_programme_action_failed_' || (SELECT count(*) FROM programme_claim)::text
      END AS integer) AS committed
    `);

    const [updated] = await db
      .select()
      .from(programmes)
      .where(and(eq(programmes.id, id), eq(programmes.tenantId, tenantId)))
      .limit(1);
    if (!updated) {
      return NextResponse.json({ error: 'Programme not found after transition' }, { status: 404 });
    }

    try {
      const statusLabel = nextStatus.replace(/_/g, ' ');
      const notificationBody = `${programme.title} (${programme.reference}) is now ${statusLabel}.`;
      if (action === 'submit') {
        const recipients = submitReviewers ?? [];
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
        let recipientUserId = programme.ownerUserId;
        if (!recipientUserId && programme.ownerEmployeeId) {
          const [ownerEmployee] = await db
            .select({ userId: employees.userId })
            .from(employees)
            .where(
              and(
                eq(employees.id, programme.ownerEmployeeId),
                eq(employees.tenantId, tenantId),
              ),
            )
            .limit(1);
          recipientUserId = ownerEmployee?.userId ?? null;
        }
        if (!recipientUserId && !programme.ownerUserId && !programme.ownerEmployeeId) {
          recipientUserId = programme.createdByUserId;
        }
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
    if (String(error).includes('atomic_programme_action_failed')) {
      return NextResponse.json(
        { error: 'This programme changed while you were reviewing it. Refresh and review the latest status before deciding.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to process programme action' }, { status: 500 });
  }
}
