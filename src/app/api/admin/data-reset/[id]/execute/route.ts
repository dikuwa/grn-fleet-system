import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { tenants } from '@/db/schema/tenants';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { executeApprovedTenantOperationalReset } from '@/lib/data-protection/reset-service';
import { normalizeResetSpec } from '@/lib/reset-catalog';
import { resetExecutionOwner } from '@/lib/reset-workflow';
import { resetExecutionHttpStatus } from '@/lib/reset-execution-http';
import {
  notifyPlatformResetExecution,
  notifyResetRequesterOutcome,
  resolveTenantResetReadyNotification,
} from '@/lib/platform/reset-notifications';
import { recordAuditEvent } from '@/lib/audit-event';
import {
  acquireResetExecutionClaim,
  releaseResetExecutionClaim,
} from '@/lib/reset-execution-guard';

export const maxDuration = 300;

/**
 * Execute a Platform-approved tenant reset from Tenant Administration.
 *
 * Operational cleanup and selective resets may be activated by the tenant
 * after Platform Administration has approved the immutable plan and verified
 * a recovery point. Protected clean-slate resets remain Platform-executed.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let claimId: string | null = null;
  let resetRequestId = '';
  let executionContext: {
    tenantId: string;
    tenantName: string;
    tenantCode: string;
    requesterUserId: string;
  } | null = null;
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;

    const { id } = await params;
    resetRequestId = id;
    const body = await request.json().catch(() => ({}));
    const confirmationPhrase =
      typeof body.confirmationPhrase === 'string' ? body.confirmationPhrase : '';

    const db = getDb();
    const [resetRequest] = await db
      .select({
        id: tenantResetRequests.id,
        tenantId: tenantResetRequests.tenantId,
        requestedByUserId: tenantResetRequests.requestedByUserId,
        status: tenantResetRequests.status,
        backupCreated: tenantResetRequests.backupCreated,
        rollbackPossible: tenantResetRequests.rollbackPossible,
        reviewedAt: tenantResetRequests.reviewedAt,
        validationResults: tenantResetRequests.validationResults,
        metadata: tenantResetRequests.metadata,
        tenantName: tenants.name,
        tenantCode: tenants.code,
      })
      .from(tenantResetRequests)
      .innerJoin(tenants, eq(tenantResetRequests.tenantId, tenants.id))
      .where(
        and(eq(tenantResetRequests.id, id), eq(tenantResetRequests.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!resetRequest) {
      return NextResponse.json({ error: 'Reset request not found.' }, { status: 404 });
    }

    const resetSpec = normalizeResetSpec(
      (resetRequest.metadata as { resetSpec?: unknown } | null)?.resetSpec,
      { target: 'tenant' },
    );
    const metadata = (resetRequest.metadata ?? {}) as Record<string, unknown>;

    if (
      resetExecutionOwner({ createdFrom: metadata.createdFrom, preset: resetSpec.preset }) !==
      'tenant'
    ) {
      return NextResponse.json(
        {
          error:
            'Tenant Administration can execute only tenant-originated operational or selective resets. This reset requires Platform execution.',
        },
        { status: 403 },
      );
    }

    const validation = (resetRequest.validationResults ?? {}) as Record<string, unknown>;
    if (
      resetRequest.status !== 'approved' ||
      !resetRequest.reviewedAt ||
      !resetRequest.backupCreated ||
      !resetRequest.rollbackPossible ||
      typeof validation.fingerprint !== 'string'
    ) {
      return NextResponse.json(
        {
          error:
            'This reset is not ready to execute. Platform approval and a verified recovery point are required.',
        },
        { status: 409 },
      );
    }
    executionContext = {
      tenantId: resetRequest.tenantId,
      tenantName: resetRequest.tenantName,
      tenantCode: resetRequest.tenantCode,
      requesterUserId: resetRequest.requestedByUserId,
    };

    const claim = await acquireResetExecutionClaim({
      resetRequestId: id,
      tenantId: session.tenantId,
      actorUserId: session.user.id,
    });
    if (!claim.ok) {
      return NextResponse.json(
        { error: claim.message, code: claim.code, data: claim.data ?? null },
        { status: claim.status },
      );
    }
    claimId = claim.claimId;

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'reset_request.tenant_execution_requested',
      entityType: 'reset_request',
      entityId: id,
      summary: 'Tenant Administrator activated a Platform-approved reset plan.',
      after: {
        preset: resetSpec.preset,
        categories: resetSpec.categories,
        approvalExpiresAt: claim.approvalExpiresAt,
      },
    });

    const result = await executeApprovedTenantOperationalReset({
      resetRequestId: id,
      actorUserId: session.user.id,
      actorTenantId: session.tenantId,
      confirmationPhrase,
      onStarted: async (context) => {
        if (!context.tenantOrigin) return;
        await Promise.all([
          resolveTenantResetReadyNotification(context.requestId),
          notifyResetRequesterOutcome({
            requestId: context.requestId,
            tenantId: context.tenantId,
            requesterUserId: context.requesterUserId,
            status: 'in_progress',
          }),
          notifyPlatformResetExecution({
            requestId: context.requestId,
            tenantName: resetRequest.tenantName,
            tenantCode: resetRequest.tenantCode,
            status: 'in_progress',
          }),
        ]);
      },
    });

    if (result.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Reset request not found.' }, { status: 404 });
    }

    if (result.tenantOrigin) {
      const failureNotes =
        result.result === 'failed'
          ? 'The reset did not pass every integrity check. The verified recovery point remains available to Platform Administration.'
          : null;
      await Promise.all([
        notifyResetRequesterOutcome({
          requestId: id,
          tenantId: result.tenantId,
          requesterUserId: result.requesterUserId,
          status: result.result,
          notes: failureNotes,
        }),
        notifyPlatformResetExecution({
          requestId: id,
          tenantName: result.tenantName,
          tenantCode: result.tenantCode,
          status: result.result,
          notes: failureNotes,
        }),
      ]).catch((notificationError) => {
        console.error(
          '[Tenant Data Reset Execute] Outcome notification failed:',
          notificationError,
        );
      });
    }

    if (result.result === 'completed') revalidatePath('/dashboard', 'layout');

    return NextResponse.json(
      { success: result.result === 'completed', data: result },
      { status: result.result === 'completed' ? 200 : 500 },
    );
  } catch (error) {
    if (claimId && resetRequestId) {
      await releaseResetExecutionClaim({ resetRequestId, claimId }).catch((releaseError) => {
        console.error(
          '[Tenant Data Reset Execute] Could not release execution claim:',
          releaseError,
        );
      });
    }
    console.error('[Tenant Data Reset Execute] POST failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    if (claimId && executionContext) {
      await Promise.all([
        notifyResetRequesterOutcome({
          requestId: resetRequestId,
          tenantId: executionContext.tenantId,
          requesterUserId: executionContext.requesterUserId,
          status: 'failed',
          notes: message,
        }),
        notifyPlatformResetExecution({
          requestId: resetRequestId,
          tenantName: executionContext.tenantName,
          tenantCode: executionContext.tenantCode,
          status: 'failed',
          notes: message,
        }),
      ]).catch((notificationError) => {
        console.error(
          '[Tenant Data Reset Execute] Failure notification failed:',
          notificationError,
        );
      });
    }
    return NextResponse.json({ error: message }, { status: resetExecutionHttpStatus(error) });
  }
}
