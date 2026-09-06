import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { previewTenantOperationalReset } from '@/lib/data-protection/reset-service';
import { recordAuditEvent } from '@/lib/audit-event';
import { normalizeResetSpec } from '@/lib/reset-catalog';
import { resolveTenantResetReadyNotification } from '@/lib/platform/reset-notifications';

/**
 * Production-safe dry run. This never mutates tenant operational data and does
 * not use the development-only environment reset guard.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const db = getDb();
    const [resetRequest] = await db
      .select()
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.id, id))
      .limit(1);
    if (!resetRequest)
      return NextResponse.json({ error: 'Reset request not found' }, { status: 404 });
    if (!['approved', 'pending_review'].includes(resetRequest.status)) {
      return NextResponse.json(
        { error: 'Dry run is available after submission/review and before execution.' },
        { status: 400 },
      );
    }

    const previousMetadata = (resetRequest.metadata ?? {}) as Record<string, unknown>;
    const resetSpec = normalizeResetSpec(previousMetadata.resetSpec, { target: 'tenant' });
    const { preview } = await previewTenantOperationalReset(resetRequest.tenantId, resetSpec);

    // A fresh plan invalidates an earlier recovery point for this request. The
    // old snapshot remains safely retained in Backup & Restore, but execution
    // requires a new snapshot tied to this exact plan. The write is revision-
    // claimed so a stale preview cannot overwrite a newer approval, backup, or
    // execution claim that completed while the preview was being calculated.
    const [updated] = await db
      .update(tenantResetRequests)
      .set({
        validationResults: {
          dryRunSummary: preview.dryRunSummary,
          steps: preview.steps,
          preserved: preview.preserved,
          review: preview.review,
          warnings: [],
          errors: [],
          fingerprint: preview.fingerprint,
          plannedAt: preview.plannedAt,
          resetSpec,
          categoryCounts: preview.categoryCounts,
          protected: preview.protected,
        },
        backupCreated: false,
        backupLocation: null,
        backupSizeBytes: null,
        backupRecordCount: null,
        rollbackPossible: false,
        metadata: {
          ...previousMetadata,
          dryRunAt: preview.plannedAt,
          dryRunFingerprint: preview.fingerprint,
          dryRunTotal: preview.dryRunSummary.total,
          backupSnapshotId: null,
          resetSpec,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenantResetRequests.id, id),
          eq(tenantResetRequests.status, resetRequest.status),
          eq(tenantResetRequests.updatedAt, resetRequest.updatedAt),
        ),
      )
      .returning({ id: tenantResetRequests.id });

    if (!updated) {
      return NextResponse.json(
        {
          error:
            'This reset request changed while the dry run was being calculated. Refresh the request and run a fresh dry run.',
        },
        { status: 409 },
      );
    }

    // A refreshed plan invalidates any earlier recovery point and therefore
    // also resolves an earlier tenant "ready to execute" action.
    await resolveTenantResetReadyNotification(id);

    await recordAuditEvent({
      tenantId: resetRequest.tenantId,
      actorUserId: session.user.id,
      action: 'reset_request.dry_run',
      entityType: 'reset_request',
      entityId: id,
      summary: `Reset-plan dry run completed; ${preview.dryRunSummary.total} tenant-scoped rows would be removed.`,
      after: {
        scope: resetRequest.scope,
        resetSpec,
        dryRunSummary: preview.dryRunSummary,
        fingerprint: preview.fingerprint,
      },
    });

    return NextResponse.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    console.error('[Platform Reset Dry-Run] POST failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
