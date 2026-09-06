import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { tenants } from '@/db/schema/tenants';
import { eq } from 'drizzle-orm';
import { executeApprovedTenantOperationalReset } from '@/lib/data-protection/reset-service';
import { normalizeResetSpec } from '@/lib/reset-catalog';
import { resetExecutionOwner } from '@/lib/reset-workflow';
import { resetExecutionHttpStatus } from '@/lib/reset-execution-http';
import { isUuid } from '@/lib/uuid';
import {
  notifyPlatformResetExecution,
  notifyResetRequesterOutcome,
  resolveTenantResetReadyNotification,
} from '@/lib/platform/reset-notifications';
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
 * claim closes the double-click/concurrent-request window before that transition without
 * introducing another database status or migration. Stale claims may be
 * reclaimed after a short TTL so an interrupted request cannot lock a reset
 * forever.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let claimId: string | null = null;
  let resetRequestId = '';
  let executionContext: {
    tenantId: string;
    tenantName: string;
    tenantCode: string;
    requesterUserId: string;
    tenantOrigin: boolean;
  } | null = null;
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Reset request not found.' }, { status: 404 });
    resetRequestId = id;
    const body = await request.json().catch(() => ({}));
    const confirmationPhrase =
      typeof body.confirmationPhrase === 'string' ? body.confirmationPhrase : '';

    const db = getDb();
    const [row] = await db
      .select({ request: tenantResetRequests, tenantName: tenants.name, tenantCode: tenants.code })
      .from(tenantResetRequests)
      .innerJoin(tenants, eq(tenantResetRequests.tenantId, tenants.id))
      .where(eq(tenantResetRequests.id, id))
      .limit(1);
    if (!row) return NextResponse.json({ error: 'Reset request not found.' }, { status: 404 });
    const metadata = (row.request.metadata ?? {}) as Record<string, unknown>;
    const resetSpec = normalizeResetSpec(metadata.resetSpec, { target: 'tenant' });
    if (
      resetExecutionOwner({ createdFrom: metadata.createdFrom, preset: resetSpec.preset }) ===
      'tenant'
    ) {
      return NextResponse.json(
        {
          error:
            'This approved operational/selective reset has been handed back to the authorised Tenant Administrator for final execution.',
        },
        { status: 403 },
      );
    }
    executionContext = {
      tenantId: row.request.tenantId,
      tenantName: row.tenantName,
      tenantCode: row.tenantCode,
      requesterUserId: row.request.requestedByUserId,
      tenantOrigin: metadata.createdFrom === 'tenant_admin',
    };

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
      confirmationPhrase,
      onStarted: async (context) => {
        await Promise.all([
          notifyPlatformResetExecution({
            requestId: context.requestId,
            tenantName: executionContext?.tenantName ?? row.tenantName,
            tenantCode: executionContext?.tenantCode ?? row.tenantCode,
            status: 'in_progress',
          }),
          ...(context.tenantOrigin
            ? [
                resolveTenantResetReadyNotification(context.requestId),
                notifyResetRequesterOutcome({
                  requestId: context.requestId,
                  tenantId: context.tenantId,
                  requesterUserId: context.requesterUserId,
                  status: 'in_progress' as const,
                }),
              ]
            : []),
        ]);
      },
    });

    const failureNotes =
      result.result === 'failed'
        ? 'The reset did not pass every integrity check. The recovery point remains available for investigation.'
        : null;
    await Promise.all([
      notifyPlatformResetExecution({
        requestId: id,
        tenantName: result.tenantName,
        tenantCode: result.tenantCode,
        status: result.result,
        notes: failureNotes,
      }),
      ...(result.tenantOrigin
        ? [
            notifyResetRequesterOutcome({
              requestId: id,
              tenantId: result.tenantId,
              requesterUserId: result.requesterUserId,
              status: result.result,
              notes: failureNotes,
            }),
          ]
        : []),
    ]).catch((notificationError) => {
      console.error('[Platform Reset Execute] Outcome notification failed:', notificationError);
    });

    if (result.result === 'completed') revalidatePath('/dashboard', 'layout');

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
    if (claimId && executionContext) {
      await Promise.all([
        notifyPlatformResetExecution({
          requestId: resetRequestId,
          tenantName: executionContext.tenantName,
          tenantCode: executionContext.tenantCode,
          status: 'failed',
          notes: message,
        }),
        ...(executionContext.tenantOrigin
          ? [
              notifyResetRequesterOutcome({
                requestId: resetRequestId,
                tenantId: executionContext.tenantId,
                requesterUserId: executionContext.requesterUserId,
                status: 'failed' as const,
                notes: message,
              }),
            ]
          : []),
      ]).catch((notificationError) => {
        console.error('[Platform Reset Execute] Failure notification failed:', notificationError);
      });
    }
    return NextResponse.json({ error: message }, { status: resetExecutionHttpStatus(error) });
  }
}
