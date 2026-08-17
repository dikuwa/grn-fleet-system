import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { executeApprovedTenantOperationalReset } from '@/lib/data-protection/reset-service';
import { notifyResetRequesterOutcome } from '@/lib/platform/reset-notifications';
import {
  acquireResetExecutionClaim,
  releaseResetExecutionClaim,
} from '@/lib/reset-execution-guard';

export const maxDuration = 300;

/**
 * Execute a production-safe tenant operational reset.
 *
 * Preconditions are enforced by the reset service: approved request, successful
 * fresh dry run, verified durable recovery point, unchanged plan fingerprint,
 * and exact `RESET <TENANT_CODE>` typed confirmation. A short-lived execution
 * claim closes the double-click/concurrent-request window before destructive
 * work begins, and approved plans expire instead of remaining executable
 * indefinitely.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let claimId: string | null = null;
  let resetRequestId = '';
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    resetRequestId = id;
    const body = await request.json().catch(() => ({}));
    const confirmationPhrase =
      typeof body.confirmationPhrase === 'string' ? body.confirmationPhrase : '';

    const claim = await acquireResetExecutionClaim({
      resetRequestId: id,
      actorUserId: session.user.id,
    });
    if (!claim.ok) {
      return NextResponse.json(
        { error: claim.message, code: claim.code, data: claim.data ?? null },
        { status: claim.status },
      );
    }
    claimId = claim.claimId;

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

    if (result.tenantOrigin) {
      await notifyResetRequesterOutcome({
        requestId: id,
        tenantId: result.tenantId,
        requesterUserId: result.requesterUserId,
        status: result.result,
        notes:
          result.result === 'failed'
            ? 'The reset did not pass every integrity check. The recovery point remains available for investigation.'
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
        console.error('[Platform Reset Execute] Could not release execution claim:', releaseError);
      });
    }
    console.error('[Platform Reset Execute] POST failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    const isPrecondition =
      /approve|expired|dry run|recovery point|confirmation|changed|operational reset|execution claim/i.test(message);
    return NextResponse.json({ error: message }, { status: isPrecondition ? 409 : 500 });
  }
}
