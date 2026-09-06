import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenants } from '@/db/schema/tenants';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  createTenantOperationalBackup,
  activeBackupSchedules,
  listBackups,
} from '@/lib/data-protection/backup-service';
import { isStorageConfigured } from '@/lib/storage';
import { recordAuditEvent } from '@/lib/audit-event';
import { isUuid } from '@/lib/uuid';

export const maxDuration = 300;

function positiveIntegerParam(value: string | null, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requirePermission(auth.session, Permissions.RESET_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get('view') === 'history' ? 'history' : 'current';
    const page = positiveIntegerParam(searchParams.get('page'), 1);
    const limit = positiveIntegerParam(searchParams.get('limit'), 20);
    const [backupPage, schedules] = await Promise.all([
      listBackups({ view, page, limit }),
      activeBackupSchedules(),
    ]);
    return NextResponse.json({
      success: true,
      data: {
        backups: backupPage.items,
        pagination: {
          page: backupPage.page,
          limit: backupPage.limit,
          total: backupPage.total,
          totalPages: backupPage.totalPages,
        },
        counts: backupPage.counts,
        schedules,
        storageConfigured: isStorageConfigured(),
      },
    });
  } catch (error) {
    console.error('[Platform Backups] GET failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
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
    const retentionDays = body.retentionDays == null ? 30 : Number(body.retentionDays);
    if (!tenantId) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    if (!isUuid(tenantId)) {
      return NextResponse.json({ error: 'tenantId must be a valid UUID' }, { status: 400 });
    }
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
      return NextResponse.json(
        { error: 'retentionDays must be an integer between 1 and 3650' },
        { status: 400 },
      );
    }

    const db = getDb();
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

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
      after: {
        recordCount: backup.recordCount,
        storageKey: backup.storageKey,
        retentionDays: backup.retentionDays,
      },
    });

    return NextResponse.json({ success: true, data: backup }, { status: 201 });
  } catch (error) {
    console.error('[Platform Backups] POST failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: message },
      { status: /^Tenant not found\.?$/i.test(message) ? 404 : 500 },
    );
  }
}
