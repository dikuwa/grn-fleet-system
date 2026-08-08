import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { executeApprovedTenantOperationalReset } from '@/lib/data-protection/reset-service';

export const maxDuration = 300;

/**
 * Execute a production-safe tenant operational reset.
 *
 * Preconditions are enforced by the reset service: approved request, successful
 * fresh dry run, verified durable recovery point, unchanged plan fingerprint,
 * and exact `RESET <TENANT_CODE>` typed confirmation.
 */
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
    const confirmationPhrase = typeof body.confirmationPhrase === 'string' ? body.confirmationPhrase : '';

    const result = await executeApprovedTenantOperationalReset({
      resetRequestId: id,
      actorUserId: session.user.id,
      actorTenantId: session.tenantId,
      confirmationPhrase,
    });

    return NextResponse.json({ success: result.result === 'completed', data: result }, { status: result.result === 'completed' ? 200 : 500 });
  } catch (error) {
    console.error('[Platform Reset Execute] POST failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    const isPrecondition = /approve|dry run|recovery point|confirmation|changed|operational reset/i.test(message);
    return NextResponse.json({ error: message }, { status: isPrecondition ? 409 : 500 });
  }
}
