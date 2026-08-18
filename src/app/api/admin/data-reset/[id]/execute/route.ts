import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { executeApprovedTenantOperationalReset } from '@/lib/data-protection/reset-service';
import { normalizeResetSpec } from '@/lib/reset-catalog';
import { notifyResetRequesterOutcome } from '@/lib/platform/reset-notifications';
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
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  let claimId: string | null = null;
  let resetRequestId = '';
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
        metadata: tenantResetRequests.metadata,
      })
      .from(tenantResetRequests)
      .where(
        and(
          eq(tenantResetRequests.id, id),
          eq(tenantResetRequests.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!resetRequest) {
      return NextResponse.json({ error: 'Reset request not found.' }, { status: 404 });
    }

    const resetSpec = normalizeResetSpec(
      (resetRequest.metadata as { resetSpec?: unknown } | null)?.resetSpec,
      { target: 'tenant' },
    );

    if (resetSpec.preset === 'clean_slate') {
      return NextResponse.json(
        {
          error:
            'Protected clean-slate resets must be executed by Platform Administration after final recovery verification.',
        },
        { status: 403 },
      );
    }

    if (resetRequest.status !== 'approved' || !resetRequest.backupCreated) {
      return NextResponse.json(
        {
          error:
            'This reset is not ready to execute. Platform approval and a verified recovery point are required.',
        },
        { status: 409 },
      );
    }

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
        await notifyResetRequesterOutcome({
          requestId: context.requestId,
          tenantId: context.tenantId,
          requesterUserId: context.requesterUserId,
          status: 'in_progress',
        });
      },
    });

    if (result.tenantId !== session.tenantId) {
      return NextResponse.json({ error: 'Reset request not found.' }, { status: 404 });
    }

    if (result.tenantOrigin) {
      await notifyResetRequesterOutcome({
        requestId: id,
        tenantId: result.tenantId,
        requesterUserId: result.requesterUserId,
        status: result.result,
        notes:
          result.result === 'failed'
            ? 'The reset did not pass every integrity check. The verified recovery point remains available to Platform Administration.'
            : null,
      });
    }

    return NextResponse.json(
      { success: result.result === 'completed', data: result },
      { status: result.result === 'completed' ? 200 : 500 },
    );
  } catch (error) {
    if (claimId && resetRequestId) {
      await releaseResetExecutionClaim({ resetRequestId, claimId }).catch((releaseError) => {
        console.error('[Tenant Data Reset Execute] Could not release execution claim:', releaseError);
      });
    }
    console.error('[Tenant Data Reset Execute] POST failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    const isPrecondition =
      /approve|expired|dry run|recovery point|confirmation|changed|operational reset|ready|execution claim/i.test(message);
    return NextResponse.json({ error: message }, { status: isPrecondition ? 409 : 500 });
  }
}
