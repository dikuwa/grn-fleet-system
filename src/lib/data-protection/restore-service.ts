import { eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackups } from '@/db/schema/data-protection';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { OPERATIONAL_DELETE_STEPS, quoteTable } from '@/lib/data-reset/config';
import { recordAuditEvent } from '@/lib/audit-event';
import { previewTenantOperationalReset } from './reset-service';
import { readBackupPayload } from './backup-service';

export async function restoreTenantOperationalBackup(input: {
  backupId: string;
  actorUserId: string;
  confirmationPhrase: string;
}) {
  const db = getDb();
  const { backup, payload } = await readBackupPayload(input.backupId);
  if (!backup.tenantId) throw new Error('This recovery point is no longer linked to a tenant');
  if (backup.restoredAt) throw new Error('This recovery point has already been restored');

  const expected = `RESTORE ${payload.tenant.code}`;
  if (input.confirmationPhrase.trim() !== expected) {
    throw new Error(`Confirmation phrase is incorrect. Type exactly: ${expected}`);
  }

  // Never merge a historical snapshot over new operations. The tenant must be
  // operationally clean first so UUIDs/references cannot collide with new work.
  const { preview } = await previewTenantOperationalReset(backup.tenantId, payload.resetSpec);
  if (preview.dryRunSummary.total > 0) {
    throw new Error(`Restore blocked: ${preview.dryRunSummary.total} current operational rows exist. Clear the tenant operational data through the reset workflow before restoring this recovery point.`);
  }

  const rowsByTable = new Map(payload.tables.map((entry) => [entry.table, entry.rows]));
  const restored: Array<{ table: string; records: number }> = [];

  // Advanced domain parents must exist before operational history is restored.
  for (const table of [...new Set(payload.advancedTableOrder ?? [])].reverse()) {
    const rows = rowsByTable.get(table) ?? [];
    if (!rows.length) continue;
    const json = JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    await db.execute(sql.raw(`INSERT INTO ${quoteTable(table)} SELECT * FROM json_populate_recordset(NULL::${quoteTable(table)}, '${json.replace(/'/g, "''")}'::json) ON CONFLICT DO NOTHING`));
    restored.push({ table, records: rows.length });
    rowsByTable.delete(table);
  }

  // Deletion registry is children→parents. Restore is the exact reverse so
  // parent rows exist before children with foreign-key dependencies.
  for (const step of [...OPERATIONAL_DELETE_STEPS].reverse()) {
    const rows = rowsByTable.get(step.table) ?? [];
    if (!rows.length) continue;
    const json = JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? value.toString() : value);
    // PostgreSQL table row types let us safely reconstruct every original
    // column without hard-coding schema-specific insert lists.
    await db.execute(sql.raw(`INSERT INTO ${quoteTable(step.table)} SELECT * FROM json_populate_recordset(NULL::${quoteTable(step.table)}, '${json.replace(/'/g, "''")}'::json) ON CONFLICT DO NOTHING`));
    restored.push({ table: step.table, records: rows.length });
  }

  const restoredAt = new Date();
  await db.update(platformBackups).set({
    restoredAt,
    restoredByUserId: input.actorUserId,
    updatedAt: restoredAt,
  }).where(eq(platformBackups.id, backup.id));

  if (backup.resetRequestId) {
    await db.update(tenantResetRequests).set({
      rollbackPerformed: true,
      rollbackCompletedAt: restoredAt,
      updatedAt: restoredAt,
    }).where(eq(tenantResetRequests.id, backup.resetRequestId));
  }

  await recordAuditEvent({
    tenantId: backup.tenantId,
    actorUserId: input.actorUserId,
    action: 'backup.restored',
    entityType: 'backup',
    entityId: backup.id,
    summary: `Operational recovery point ${backup.id} restored for ${payload.tenant.name}.`,
    after: {
      backupId: backup.id,
      resetRequestId: backup.resetRequestId,
      recordsRestored: restored.reduce((sum, item) => sum + item.records, 0),
      tables: restored,
    },
  });

  return {
    backupId: backup.id,
    tenantId: backup.tenantId,
    tenantName: payload.tenant.name,
    tenantCode: payload.tenant.code,
    restoredAt,
    recordsRestored: restored.reduce((sum, item) => sum + item.records, 0),
    tables: restored,
  };
}
