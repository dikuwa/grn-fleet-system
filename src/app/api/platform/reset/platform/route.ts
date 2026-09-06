import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { previewPlatformOperationalReset } from '@/lib/data-protection/platform-reset-service';
import {
  createVerifiedPlatformOperationalBackup,
  executeVerifiedPlatformOperationalReset,
} from '@/lib/data-protection/platform-reset-snapshot';
import {
  acquirePlatformResetExecutionClaim,
  releasePlatformResetExecutionClaim,
} from '@/lib/data-protection/platform-reset-claim';

export const maxDuration = 300;

async function authorize(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.RESET_MANAGE);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  return auth;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.error;
    return NextResponse.json({ success: true, data: await previewPlatformOperationalReset() });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  let executionClaimId: string | null = null;
  let executionBackupId = '';
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.error;
    const body = await request.json().catch(() => ({}));
    const action = typeof body.action === 'string' ? body.action : '';
    const expectedFingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : '';
    if (!expectedFingerprint)
      return NextResponse.json(
        { error: 'Refresh the platform impact preview first' },
        { status: 400 },
      );

    if (action === 'backup') {
      const backup = await createVerifiedPlatformOperationalBackup({
        actorUserId: auth.session.user.id,
        expectedFingerprint,
      });
      return NextResponse.json({ success: true, data: backup }, { status: 201 });
    }
    if (action === 'execute') {
      const backupId = typeof body.backupId === 'string' ? body.backupId : '';
      const confirmationPhrase =
        typeof body.confirmationPhrase === 'string' ? body.confirmationPhrase : '';
      if (!backupId)
        return NextResponse.json(
          { error: 'Create a verified platform recovery point first' },
          { status: 409 },
        );

      const claim = await acquirePlatformResetExecutionClaim({
        backupId,
        actorUserId: auth.session.user.id,
      });
      if (!claim.ok) {
        return NextResponse.json(
          { error: claim.message, code: claim.code },
          { status: claim.status },
        );
      }
      executionClaimId = claim.claimId;
      executionBackupId = backupId;

      const result = await executeVerifiedPlatformOperationalReset({
        actorUserId: auth.session.user.id,
        actorTenantId: auth.session.tenantId,
        expectedFingerprint,
        backupId,
        confirmationPhrase,
      });
      await releasePlatformResetExecutionClaim({
        backupId,
        claimId: executionClaimId,
      }).catch((releaseError) => {
        console.error('[Platform Operational Reset] Could not release execution claim:', releaseError);
      });
      executionClaimId = null;
      revalidatePath('/dashboard', 'layout');
      return NextResponse.json({ success: true, data: result });
    }
    return NextResponse.json({ error: 'Action must be backup or execute' }, { status: 400 });
  } catch (error) {
    if (executionClaimId && executionBackupId) {
      await releasePlatformResetExecutionClaim({
        backupId: executionBackupId,
        claimId: executionClaimId,
      }).catch((releaseError) => {
        console.error('[Platform Operational Reset] Could not release execution claim:', releaseError);
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    const conflict = /changed|recovery|checksum|type exactly|archive|verified snapshot/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
  }
}
