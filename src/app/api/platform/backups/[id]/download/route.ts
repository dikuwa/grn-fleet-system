import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getBackupDownloadUrl } from '@/lib/data-protection/backup-service';
import { isUuid } from '@/lib/uuid';

export async function GET(
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
    const { url } = await getBackupDownloadUrl(id);
    return NextResponse.json({ success: true, data: { url, expiresInSeconds: 900 } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
