import { NextRequest, NextResponse } from 'next/server';
import { and, eq, ne } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackupSchedules } from '@/db/schema/data-protection';
import { tenants } from '@/db/schema/tenants';
import {
  createTenantOperationalBackup,
  dueBackupSchedules,
  expireOldBackups,
  nextScheduleRun,
} from '@/lib/data-protection/backup-service';
import { reconcileStaleInProgressResets } from '@/lib/data-protection/reset-reconciliation';
import { isStorageConfigured } from '@/lib/storage';

export const maxDuration = 300;

function cronAuthorized(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return process.env.NODE_ENV !== 'production';
  const authHeader = request.headers.get('authorization');
  const provided =
    authHeader?.replace(/^Bearer\s+/i, '') || request.nextUrl.searchParams.get('token') || '';
  return provided === expected;
}

export async function GET(request: NextRequest) {
  if (!cronAuthorized(request))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const resetReconciliation = await reconcileStaleInProgressResets();
    if (!isStorageConfigured()) {
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: 'Durable R2/S3 backup storage is not configured.',
        resetReconciliation,
      });
    }

    const db = getDb();
    const now = new Date();
    const expired = await expireOldBackups(now);
    const schedules = await dueBackupSchedules(now);
    const results: Array<{
      scheduleId: string;
      tenantId: string;
      status: 'created' | 'failed';
      backupId?: string;
      error?: string;
    }> = [];

    for (const schedule of schedules) {
      const targetTenants = schedule.tenantId
        ? await db
            .select({ id: tenants.id })
            .from(tenants)
            .where(eq(tenants.id, schedule.tenantId))
            .limit(1)
        : await db
            .select({ id: tenants.id })
            .from(tenants)
            .where(and(eq(tenants.status, 'ACTIVE'), ne(tenants.type, 'demo_sandbox')));

      for (const tenant of targetTenants) {
        try {
          const backup = await createTenantOperationalBackup({
            tenantId: tenant.id,
            source: 'scheduled',
            reason: `${schedule.frequency} scheduled operational recovery point`,
            retentionDays: schedule.retentionDays,
          });
          results.push({
            scheduleId: schedule.id,
            tenantId: tenant.id,
            status: 'created',
            backupId: backup.id,
          });
        } catch (error) {
          results.push({
            scheduleId: schedule.id,
            tenantId: tenant.id,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      await db
        .update(platformBackupSchedules)
        .set({
          lastRunAt: now,
          nextRunAt: nextScheduleRun(schedule.frequency, now),
          updatedAt: new Date(),
        })
        .where(eq(platformBackupSchedules.id, schedule.id));
    }

    return NextResponse.json({
      success: true,
      resetReconciliation,
      dueSchedules: schedules.length,
      expiredBackups: expired,
      created: results.filter((item) => item.status === 'created').length,
      failed: results.filter((item) => item.status === 'failed').length,
      results,
    });
  } catch (error) {
    console.error('[cron/platform-backups] Failed:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
