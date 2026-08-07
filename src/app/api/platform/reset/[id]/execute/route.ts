/**
 * Platform Reset Execute API
 *
 * POST /api/platform/reset/[id]/execute — Execute a reset request
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { tenantResetRequests, resetRequestSteps } from '@/db/schema/reset-requests';
import { eq } from 'drizzle-orm';
import { runDevelopmentDataReset, type ResetOptions, type ResetMode } from '@/lib/data-reset/engine';
import { recordAuditEvent } from '@/lib/audit-event';

// ---------------------------------------------------------------------------
// POST — Execute a reset
// ---------------------------------------------------------------------------

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const { confirmationPhrase } = body;

    const db = getDb();

    // Fetch the reset request
    const [resetRequest] = await db
      .select()
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.id, id))
      .limit(1);

    if (!resetRequest) {
      return NextResponse.json({ error: 'Reset request not found' }, { status: 404 });
    }

    if (resetRequest.status !== 'approved') {
      return NextResponse.json(
        { error: 'Reset request must be approved before execution' },
        { status: 400 },
      );
    }

    // Map scope to reset mode
    const scopeToMode: Record<string, ResetMode> = {
      operational: 'operational',
      temporary_data: 'operational',
      fleet: 'operational',
      user_access: 'operational',
      full: 'operational',
    };

    const mode = scopeToMode[resetRequest.scope] || 'operational';

    // Mark as in_progress
    await db
      .update(tenantResetRequests)
      .set({
        status: 'in_progress',
        startedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenantResetRequests.id, id));

    // Execute the reset
    const opts: ResetOptions = {
      tenantId: resetRequest.tenantId,
      mode,
      dryRun: false,
      initiator: `platform-admin:${session.user.id}`,
      confirmPhrase: confirmationPhrase,
      skipStorage: true,
      skipFiles: true,
    };

    const outcome = await runDevelopmentDataReset(opts);

    const isSuccess = outcome.report.result === 'completed';
    const executionTimeMs = outcome.plan?.timestamp
      ? Date.now() - new Date(outcome.plan.timestamp).getTime()
      : null;

    // Record step outcomes
    for (const step of outcome.report.steps) {
      await db.insert(resetRequestSteps).values({
        resetRequestId: id,
        stepOrder: outcome.report.steps.indexOf(step),
        stepName: step.label,
        tableName: step.table,
        recordsDeleted: step.removed,
        recordsPreserved: step.planned - step.removed,
        status: step.removed === step.planned ? 'completed' : 'failed',
        error: step.planned !== step.removed ? 'Partial deletion' : null,
        details: {
          planned: step.planned,
          removed: step.removed,
        },
      });
    }

    // Update reset request with results
    await db
      .update(tenantResetRequests)
      .set({
        status: isSuccess ? 'completed' : 'failed',
        completedAt: new Date(),
        executionTimeMs,
        results: {
          dryRunSummary: outcome.report.dryRunSummary,
          steps: outcome.report.steps,
          storageFilesRemoved: outcome.report.storageFilesRemoved,
          integrity: outcome.report.integrity,
        },
        failureReason: isSuccess ? null : outcome.report.errors.join('; '),
        backupCreated: !!outcome.backup,
        backupLocation: outcome.backup?.directory || null,
        backupRecordCount: outcome.backup?.records || null,
        updatedAt: new Date(),
      })
      .where(eq(tenantResetRequests.id, id));

    // Record audit event
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'reset_request.executed',
      entityType: 'reset_request',
      entityId: id,
      summary: `Reset request ${id} executed — result: ${outcome.report.result}`,
      after: {
        scope: resetRequest.scope,
        result: outcome.report.result,
        totalRemoved: outcome.report.dryRunSummary.total,
        executionTimeMs,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        result: outcome.report.result,
        report: outcome.report,
      },
    });
  } catch (error) {
    console.error('[Platform Reset Execute] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
