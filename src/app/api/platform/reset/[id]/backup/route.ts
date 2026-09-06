import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { platformBackups } from '@/db/schema/data-protection';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { createTenantOperationalBackup } from '@/lib/data-protection/backup-service';
import { previewTenantOperationalReset } from '@/lib/data-protection/reset-service';
import { recordAuditEvent } from '@/lib/audit-event';
import { normalizeResetSpec } from '@/lib/reset-catalog';
import { resetExecutionOwner } from '@/lib/reset-workflow';
import { notifyResetRequesterReady } from '@/lib/platform/reset-notifications';
import { isResetApprovalExpired } from '@/lib/reset-execution-guard';
import { isUuid } from '@/lib/uuid';

export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Reset request not found' }, { status: 404 });
    const db = getDb();
    const [resetRequest] = await db
      .select()
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.id, id))
      .limit(1);
    if (!resetRequest)
      return NextResponse.json({ error: 'Reset request not found' }, { status: 404 });
    if (resetRequest.status !== 'approved')
      return NextResponse.json(
        { error: 'Approve the reset request before creating its recovery point' },
        { status: 400 },
      );
    if (isResetApprovalExpired(resetRequest.reviewedAt))
      return NextResponse.json(
        {
          error:
            'This approval expired. Run a fresh impact preview and renew Platform approval before creating a recovery point.',
        },
        { status: 409 },
      );
    const requestMetadata = (resetRequest.metadata ?? {}) as Record<string, unknown>;
    const resetSpec = normalizeResetSpec(requestMetadata.resetSpec, { target: 'tenant' });

    const validation = (resetRequest.validationResults ?? {}) as Record<string, unknown>;
    const storedFingerprint =
      typeof validation.fingerprint === 'string' ? validation.fingerprint : null;
    const storedSummary = validation.dryRunSummary as { total?: unknown } | undefined;
    if (!storedFingerprint || !storedSummary) {
      return NextResponse.json(
        { error: 'Run a fresh dry run before creating a recovery point' },
        { status: 409 },
      );
    }

    const { preview, plan, advancedPlan } = await previewTenantOperationalReset(
      resetRequest.tenantId,
      resetSpec,
    );
    if (
      preview.fingerprint !== storedFingerprint ||
      preview.dryRunSummary.total !== Number(storedSummary.total ?? -1)
    ) {
      return NextResponse.json(
        {
          error:
            'Selected data changed after the dry run. Run the dry run again before creating the recovery point.',
        },
        { status: 409 },
      );
    }

    const backup = await createTenantOperationalBackup({
      tenantId: resetRequest.tenantId,
      source: 'pre_reset',
      reason: `Pre-reset recovery point: ${resetRequest.reason}`,
      createdByUserId: session.user.id,
      resetRequestId: resetRequest.id,
      retentionDays: 90,
      plan,
      advancedPlan,
    });

    if (backup.recordCount !== preview.dryRunSummary.total) {
      await db
        .update(platformBackups)
        .set({
          status: 'failed',
          isProtected: false,
          failureReason: `Backup row count ${backup.recordCount} did not match dry-run row count ${preview.dryRunSummary.total}.`,
          updatedAt: new Date(),
        })
        .where(eq(platformBackups.id, backup.id));
      await db
        .update(tenantResetRequests)
        .set({
          backupCreated: false,
          backupLocation: null,
          rollbackPossible: false,
          updatedAt: new Date(),
        })
        .where(eq(tenantResetRequests.id, resetRequest.id));
      return NextResponse.json(
        {
          error:
            'Recovery point verification failed because the data changed. Run a new dry run and try again.',
        },
        { status: 409 },
      );
    }

    await recordAuditEvent({
      tenantId: resetRequest.tenantId,
      actorUserId: session.user.id,
      action: 'reset_request.backup_created',
      entityType: 'reset_request',
      entityId: resetRequest.id,
      summary: `Durable pre-reset recovery point ${backup.id} created with ${backup.recordCount} records.`,
      after: {
        backupSnapshotId: backup.id,
        storageKey: backup.storageKey,
        recordCount: backup.recordCount,
        checksum: backup.checksum,
        retentionDays: backup.retentionDays,
      },
    });

    if (
      resetExecutionOwner({
        createdFrom: requestMetadata.createdFrom,
        preset: resetSpec.preset,
      }) === 'tenant'
    ) {
      await notifyResetRequesterReady({
        requestId: resetRequest.id,
        tenantId: resetRequest.tenantId,
        requesterUserId: resetRequest.requestedByUserId,
      }).catch((notificationError) => {
        console.error(
          '[Platform Reset Backup] Recovery-ready notification failed:',
          notificationError,
        );
      });
    }

    return NextResponse.json({ success: true, data: backup }, { status: 201 });
  } catch (error) {
    console.error('[Platform Reset Backup] POST failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
