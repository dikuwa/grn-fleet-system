import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  deleteBackupWithPlatformResetFence,
  setBackupProtectionWithPlatformResetFence,
} from '@/lib/data-protection/platform-reset-claim';
import { recordAuditEvent } from '@/lib/audit-event';
import { isUuid } from '@/lib/uuid';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requirePermission(auth.session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    const body = await request.json();
    if (typeof body.isProtected !== 'boolean')
      return NextResponse.json({ error: 'isProtected boolean is required' }, { status: 400 });
    const backup = await setBackupProtectionWithPlatformResetFence(id, body.isProtected);
    return NextResponse.json({ success: true, data: backup });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message)
      ? 404
      : /protected|required|cannot be released|active operational reset|locked|deletion is already in progress|changed while deletion/i.test(message)
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requirePermission(auth.session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;
    const { id } = await params;
    if (!isUuid(id)) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    const backup = await deleteBackupWithPlatformResetFence(id);
    await recordAuditEvent({
      tenantId: backup.tenantId ?? auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'backup.deleted',
      entityType: 'backup',
      entityId: backup.id,
      summary: `Recovery point ${backup.id} was deleted from durable storage and archived from the active view.`,
      before: {
        scope: backup.scope,
        source: backup.source,
        resetRequestId: backup.resetRequestId,
        storageKeyPresent: true,
      },
      after: { status: backup.status, storageKeyPresent: false },
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message)
      ? 404
      : /protected|required|cannot be released|active operational reset|locked|deletion is already in progress|changed while deletion/i.test(message)
        ? 409
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
