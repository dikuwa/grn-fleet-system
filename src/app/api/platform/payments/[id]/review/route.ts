/**
 * Platform Payment Review Detail API
 *
 * PATCH  /api/platform/payments/[id]/review — Approve or reject a payment submission
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { approvePaymentSubmission, rejectPaymentSubmission } from '@/lib/platform/subscriptions';
import { recordAuditEvent } from '@/lib/audit-event';

// ---------------------------------------------------------------------------
// PATCH — Approve or reject a payment submission
// ---------------------------------------------------------------------------

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.PLATFORM_ADMIN);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await request.json();
    const { action, notes, reason } = body;

    if (!action || !['approve', 'reject'].includes(action)) {
      return NextResponse.json(
        { error: 'Action must be "approve" or "reject"' },
        { status: 400 },
      );
    }

    if (action === 'reject' && !reason) {
      return NextResponse.json(
        { error: 'Rejection reason is required' },
        { status: 400 },
      );
    }

    if (action === 'approve') {
      await approvePaymentSubmission(id, session.user.id, notes);
    } else {
      await rejectPaymentSubmission(id, session.user.id, reason);
    }

    // Audit the review
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: `payment_submission.${action}d`,
      entityType: 'payment_submission',
      entityId: id,
      summary: `Payment submission ${action}d`,
      after: { notes: notes || null, rejectionReason: reason || null },
    });

    return NextResponse.json({
      success: true,
      data: { action, message: `Payment submission ${action}d` },
    });
  } catch (error) {
    console.error('[Platform Payment Review] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}