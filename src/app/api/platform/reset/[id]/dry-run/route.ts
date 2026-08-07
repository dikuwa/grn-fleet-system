/**
 * Platform Reset Dry-Run API
 *
 * POST /api/platform/reset/[id]/dry-run — Run a dry-run for a reset request
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { eq } from 'drizzle-orm';
import { runDevelopmentDataReset, type ResetOptions, type ResetMode } from '@/lib/data-reset/engine';
import { recordAuditEvent } from '@/lib/audit-event';

// ---------------------------------------------------------------------------
// POST — Execute dry-run for a reset request
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

    // Map scope to reset mode
    const scopeToMode: Record<string, ResetMode> = {
      operational: 'operational',
      temporary_data: 'operational',
      fleet: 'operational',
      user_access: 'operational',
      full: 'operational',
    };

    const mode = scopeToMode[resetRequest.scope] || 'operational';

    // Execute dry-run
    const opts: ResetOptions = {
      tenantId: resetRequest.tenantId,
      mode,
      dryRun: true,
      initiator: `platform-admin:${session.user.id}`,
      skipStorage: true,
      skipFiles: true,
    };

    const outcome = await runDevelopmentDataReset(opts);

    // Update request with validation results
    await db
      .update(tenantResetRequests)
      .set({
        validationResults: {
          dryRunSummary: outcome.report.dryRunSummary,
          steps: outcome.report.steps,
          preserved: outcome.report.preserved,
          review: outcome.report.review,
          warnings: outcome.report.warnings,
          errors: outcome.report.errors,
        },
        updatedAt: new Date(),
      })
      .where(eq(tenantResetRequests.id, id));

    // Record audit event
    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'reset_request.dry_run',
      entityType: 'reset_request',
      entityId: id,
      summary: `Dry-run for reset request ${id} (${resetRequest.scope})`,
      after: {
        scope: resetRequest.scope,
        dryRunSummary: outcome.report.dryRunSummary,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        report: outcome.report,
        dryRunSummary: outcome.report.dryRunSummary,
        steps: outcome.report.steps,
        preserved: outcome.report.preserved,
        review: outcome.report.review,
      },
    });
  } catch (error) {
    console.error('[Platform Reset Dry-Run] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
