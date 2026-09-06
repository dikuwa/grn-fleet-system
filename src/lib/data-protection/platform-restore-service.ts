import { and, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackups } from '@/db/schema';
import { quoteTable } from '@/lib/data-reset/config';
import { recordAuditEvent } from '@/lib/audit-event';
import {
  PLATFORM_OPERATIONAL_TABLES,
  readPlatformOperationalBackup,
} from './platform-reset-service';

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

function firstExecuteRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) return result[0] as Record<string, unknown> | undefined;
  return (result as { rows?: Array<Record<string, unknown>> } | null)?.rows?.[0];
}

/**
 * Restore a platform-operational recovery point as one database transaction.
 *
 * The durable archive is downloaded and verified before locks are acquired.
 * Inside the transaction we serialize platform restores, lock every table that
 * participates in the reset/restore family, revalidate the backup row and the
 * current disposable-data target, restore every table, and mark the recovery
 * point restored. A failure at any point rolls back the whole restore.
 */
export async function restorePlatformOperationalBackupAtomically(input: {
  backupId: string;
  actorUserId: string;
  actorTenantId: string;
  confirmationPhrase: string;
}) {
  if (input.confirmationPhrase !== 'RESTORE PLATFORM') {
    throw new Error('Confirmation phrase is incorrect. Type exactly: RESTORE PLATFORM');
  }

  const { backup, payload } = await readPlatformOperationalBackup(input.backupId);
  const db = getDb();
  const restoredAt = new Date();
  const restored = await db.transaction(async (tx) => {
    // Serialize platform restore attempts first, then prevent ordinary writers
    // from creating a partial/phantom target while the archive is applied.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('govfleet-platform-operational-restore'))`);
    await tx.execute(
      sql.raw(
        'LOCK TABLE platform_backups, cms_enquiries, demo_requests, demo_sandboxes, notifications, notification_deliveries, notification_reads, notification_dismissals IN SHARE ROW EXCLUSIVE MODE',
      ),
    );

    const [currentBackup] = await tx
      .select({
        id: platformBackups.id,
        scope: platformBackups.scope,
        status: platformBackups.status,
        storageKey: platformBackups.storageKey,
        checksum: platformBackups.checksum,
        restoredAt: platformBackups.restoredAt,
      })
      .from(platformBackups)
      .where(eq(platformBackups.id, input.backupId))
      .limit(1);

    if (
      !currentBackup ||
      currentBackup.scope !== 'platform_operational' ||
      currentBackup.status !== 'ready' ||
      !currentBackup.storageKey ||
      currentBackup.checksum !== backup.checksum
    ) {
      throw new Error('Verified platform recovery point changed before restore could start');
    }
    if (currentBackup.restoredAt) {
      throw new Error('This recovery point has already been restored');
    }

    const targetCountResult = await tx.execute(sql.raw(`
      WITH target_notifications AS (
        SELECT n.id
        FROM notifications n
        WHERE n.workspace = 'platform_admin'
          AND (
            n.status IN ('resolved', 'dismissed', 'archived')
            OR (
              n.entity_type = 'public_enquiry'
              AND EXISTS (SELECT 1 FROM cms_enquiries ce WHERE ce.id::text = n.entity_id::text)
            )
            OR (
              n.entity_type = 'demo_request'
              AND EXISTS (SELECT 1 FROM demo_requests dr WHERE dr.id::text = n.entity_id::text)
            )
          )
      )
      SELECT (
        (SELECT COUNT(*) FROM cms_enquiries)
        + (SELECT COUNT(*) FROM demo_requests dr LEFT JOIN demo_sandboxes ds ON ds.demo_request_id = dr.id WHERE ds.id IS NULL)
        + (SELECT COUNT(*) FROM target_notifications)
        + (SELECT COUNT(*) FROM notification_deliveries nd WHERE nd.notification_id IN (SELECT id FROM target_notifications))
        + (SELECT COUNT(*) FROM notification_reads nr WHERE nr.notification_id IN (SELECT id FROM target_notifications))
        + (SELECT COUNT(*) FROM notification_dismissals nx WHERE nx.notification_id IN (SELECT id FROM target_notifications))
      )::int AS total
    `));
    const currentTotal = Number(firstExecuteRow(targetCountResult)?.total ?? 0);
    if (currentTotal > 0) {
      throw new Error(
        `Restore blocked: ${currentTotal} current platform operational rows exist. Clear them through Platform Operational Reset before restoring this recovery point.`,
      );
    }

    const rowsByTable = new Map(payload.tables.map((entry) => [entry.table, entry.rows]));
    const restoredTables: Array<{ table: string; records: number }> = [];
    for (const table of PLATFORM_OPERATIONAL_TABLES) {
      const rows = rowsByTable.get(table) ?? [];
      if (!rows.length) continue;
      const json = JSON.stringify(rows, jsonReplacer).replace(/'/g, "''");
      await tx.execute(
        sql.raw(
          `INSERT INTO ${quoteTable(table)} SELECT * FROM json_populate_recordset(NULL::${quoteTable(table)}, '${json}'::json)`,
        ),
      );
      restoredTables.push({ table, records: rows.length });
    }

    const [markedRestored] = await tx
      .update(platformBackups)
      .set({
        restoredAt,
        restoredByUserId: input.actorUserId,
        updatedAt: restoredAt,
      })
      .where(
        and(
          eq(platformBackups.id, input.backupId),
          eq(platformBackups.status, 'ready'),
          isNull(platformBackups.restoredAt),
        ),
      )
      .returning({ id: platformBackups.id });
    if (!markedRestored) {
      throw new Error('This recovery point changed while the restore was finalizing');
    }

    return restoredTables;
  });

  const recordsRestored = restored.reduce((total, item) => total + item.records, 0);
  await recordAuditEvent({
    tenantId: input.actorTenantId,
    actorUserId: input.actorUserId,
    action: 'platform_operational_backup.restored',
    entityType: 'platform_backup',
    entityId: backup.id,
    summary: `Platform operational recovery point ${backup.id} restored; ${recordsRestored} records recovered.`,
    after: { backupId: backup.id, recordsRestored, tables: restored },
  });

  return { backupId: backup.id, restoredAt, recordsRestored, tables: restored };
}
