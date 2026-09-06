import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackups } from '@/db/schema';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { restorePlatformOperationalBackupAtomically } from '@/lib/data-protection/platform-restore-service';
import { restoreTenantOperationalBackup } from '@/lib/data-protection/restore-service';
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
    if (!isUuid(id)) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    const body = await request.json().catch(() => ({}));
    const confirmationPhrase =
      typeof body.confirmationPhrase === 'string' ? body.confirmationPhrase : '';
    const db = getDb();
    const [backup] = await db
      .select({ scope: platformBackups.scope })
      .from(platformBackups)
      .where(eq(platformBackups.id, id))
      .limit(1);
    if (!backup) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    const result =
      backup.scope === 'platform_operational'
        ? await restorePlatformOperationalBackupAtomically({
            backupId: id,
            actorUserId: session.user.id,
            actorTenantId: session.tenantId,
            confirmationPhrase,
          })
        : await restoreTenantOperationalBackup({
            backupId: id,
            actorUserId: session.user.id,
            confirmationPhrase,
          });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const conflict = /blocked|confirmation|already been restored|clean|changed/i.test(message);
    const status = /not found/i.test(message) ? 404 : conflict ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
