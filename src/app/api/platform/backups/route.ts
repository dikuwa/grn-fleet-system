import { NextRequest, NextResponse } from 'next/server';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { createTenantOperationalBackup, activeBackupSchedules, listBackups } from '@/lib/data-protection/backup-service';
import { isStorageConfigured } from '@/lib/storage';
import { recordAuditEvent } from '@/lib/audit-event';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requirePermission(auth.session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const [backups, schedules] = await Promise.all([listBackups(), activeBackupSchedules()]);
    return NextResponse.json({
      success: true,
      data: { backups, schedules, storageConfigured: isStorageConfigured() },
    });
  } catch (error) {
    console.error('[Platform Backups] GET failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permCheck = await requirePermission(session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const tenantId = typeof body.tenantId === 'string' ? body.tenantId : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    const retentionDays = Number(body.retentionDays || 30);
    if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });

    const backup = await createTenantOperationalBackup({
      tenantId,
      source: 'manual',
      reason: reason || 'Manual Platform Administrator recovery point',
      retentionDays,
      createdByUserId: session.user.id,
    });

    await recordAuditEvent({
      tenantId,
      actorUserId: session.user.id,
      action: 'backup.created',
      entityType: 'backup',
      entityId: backup.id,
      summary: `Manual operational recovery point ${backup.id} created.`,
      after: { recordCount: backup.recordCount, storageKey: backup.storageKey, retentionDays: backup.retentionDays },
    });

    return NextResponse.json({ success: true, data: backup }, { status: 201 });
  } catch (error) {
    console.error('[Platform Backups] POST failed:', error);
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
