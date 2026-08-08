import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { restoreTenantOperationalBackup } from '@/lib/data-protection/restore-service';

export const maxDuration = 300;

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
    const result = await restoreTenantOperationalBackup({ backupId: id, actorUserId: session.user.id, confirmationPhrase });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const conflict = /blocked|confirmation|already been restored|clean/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 500 });
  }
}
