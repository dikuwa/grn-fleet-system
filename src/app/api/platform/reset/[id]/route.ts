/**
 * Platform Reset Request Detail API
 *
 * GET    /api/platform/reset/[id] — Get reset request details
 * PATCH  /api/platform/reset/[id] — Update status (approve/reject/submit)
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { tenantResetRequests, resetRequestSteps } from '@/db/schema/reset-requests';
import { tenants, user } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { recordAuditEvent } from '@/lib/audit-event';
import {
  notifyResetRequesterOutcome,
  resolvePlatformResetRequestNotification,
} from '@/lib/platform/reset-notifications';

// ---------------------------------------------------------------------------
// GET — Get reset request details with step history
// ---------------------------------------------------------------------------

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(_request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const db = getDb();

    const [request] = await db
      .select({
        id: tenantResetRequests.id,
        tenantId: tenantResetRequests.tenantId,
        tenantName: tenants.name,
        tenantCode: tenants.code,
        scope: tenantResetRequests.scope,
        reason: tenantResetRequests.reason,
        status: tenantResetRequests.status,
        requestedByUserId: tenantResetRequests.requestedByUserId,
        requestedByName: user.name,
        requestedByEmail: user.email,
        backupRequired: tenantResetRequests.backupRequired,
        backupCreated: tenantResetRequests.backupCreated,
        backupLocation: tenantResetRequests.backupLocation,
        backupSizeBytes: tenantResetRequests.backupSizeBytes,
        backupRecordCount: tenantResetRequests.backupRecordCount,
        startedAt: tenantResetRequests.startedAt,
        completedAt: tenantResetRequests.completedAt,
        executionTimeMs: tenantResetRequests.executionTimeMs,
        reviewedByUserId: tenantResetRequests.reviewedByUserId,
        reviewedAt: tenantResetRequests.reviewedAt,
        reviewNotes: tenantResetRequests.reviewNotes,
        results: tenantResetRequests.results,
        validationResults: tenantResetRequests.validationResults,
        failureReason: tenantResetRequests.failureReason,
        rollbackPossible: tenantResetRequests.rollbackPossible,
        rollbackPerformed: tenantResetRequests.rollbackPerformed,
        rollbackCompletedAt: tenantResetRequests.rollbackCompletedAt,
        metadata: tenantResetRequests.metadata,
        createdAt: tenantResetRequests.createdAt,
        updatedAt: tenantResetRequests.updatedAt,
      })
      .from(tenantResetRequests)
      .leftJoin(tenants, eq(tenantResetRequests.tenantId, tenants.id))
      .leftJoin(user, eq(tenantResetRequests.requestedByUserId, user.id))
      .where(eq(tenantResetRequests.id, id))
      .limit(1);

    if (!request) {
      return NextResponse.json({ error: 'Reset request not found' }, { status: 404 });
    }

    // Fetch execution steps
    const steps = await db
      .select()
      .from(resetRequestSteps)
      .where(eq(resetRequestSteps.resetRequestId, id))
      .orderBy(resetRequestSteps.stepOrder);

    return NextResponse.json({
      success: true,
      data: { request, steps },
    });
  } catch (error) {
    console.error('[Platform Reset Detail] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — Update reset request status
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await request.json();
    const { action, reviewNotes, reason } = body;

    if (!action) {
      return NextResponse.json(
        { error: 'action is required (submit, approve, reject)' },
        { status: 400 },
      );
    }

    const validActions = ['submit', 'approve', 'reject'];
    if (!validActions.includes(action)) {
      return NextResponse.json(
        { error: `Invalid action. Must be one of: ${validActions.join(', ')}` },
        { status: 400 },
      );
    }

    const db = getDb();

    // Fetch current request
    const [current] = await db
      .select()
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.id, id))
      .limit(1);

    if (!current) {
      return NextResponse.json({ error: 'Reset request not found' }, { status: 404 });
    }

    // Validate status transitions
    const updates: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    switch (action) {
      case 'submit': {
        if (current.status !== 'draft') {
          return NextResponse.json(
            { error: 'Can only submit requests in draft status' },
            { status: 400 },
          );
        }
        updates.status = 'pending_review';
        break;
      }
      case 'approve': {
        if (current.status !== 'pending_review') {
          return NextResponse.json(
            { error: 'Can only approve requests in pending_review status' },
            { status: 400 },
          );
        }
        const validation = (current.validationResults ?? {}) as Record<string, unknown>;
        if (typeof validation.fingerprint !== 'string') {
          return NextResponse.json(
            { error: 'Run and review the operational impact preview before approval' },
            { status: 409 },
          );
        }
        if (typeof reviewNotes !== 'string' || reviewNotes.trim().length < 10) {
          return NextResponse.json(
            { error: 'Add review notes of at least 10 characters before approval' },
            { status: 400 },
          );
        }
        updates.status = 'approved';
        updates.reviewedByUserId = session.user.id;
        updates.reviewedAt = new Date();
        if (reviewNotes) updates.reviewNotes = reviewNotes;
        break;
      }
      case 'reject': {
        if (current.status !== 'pending_review') {
          return NextResponse.json(
            { error: 'Can only reject requests in pending_review status' },
            { status: 400 },
          );
        }
        if (typeof reason !== 'string' || reason.trim().length < 10) {
          return NextResponse.json(
            { error: 'Provide a rejection reason of at least 10 characters' },
            { status: 400 },
          );
        }
        updates.status = 'rejected';
        updates.reviewedByUserId = session.user.id;
        updates.reviewedAt = new Date();
        updates.failureReason = reason || 'Rejected by platform admin';
        if (reviewNotes) updates.reviewNotes = reviewNotes;
        break;
      }
    }

    const [updated] = await db
      .update(tenantResetRequests)
      .set(updates)
      .where(eq(tenantResetRequests.id, id))
      .returning();

    // Record audit event
    await recordAuditEvent({
      tenantId: current.tenantId,
      actorUserId: session.user.id,
      action: `reset_request.${action}`,
      entityType: 'reset_request',
      entityId: id,
      summary: `Reset request ${action}d: ${current.status} → ${updates.status}`,
      after: {
        previousStatus: current.status,
        newStatus: updates.status,
        reviewNotes: reviewNotes || null,
        reason: reason || null,
      },
    });

    if (action === 'approve' || action === 'reject') {
      const tenantOrigin =
        (current.metadata as Record<string, unknown> | null)?.createdFrom === 'tenant_admin';
      await resolvePlatformResetRequestNotification(id);
      if (tenantOrigin) {
        await notifyResetRequesterOutcome({
          requestId: id,
          tenantId: current.tenantId,
          requesterUserId: current.requestedByUserId,
          status: action === 'approve' ? 'approved' : 'rejected',
          notes: action === 'reject' ? String(reason || reviewNotes || '') : reviewNotes,
        });
      }
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[Platform Reset Detail] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
