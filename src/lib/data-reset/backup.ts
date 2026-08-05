/**
 * Development Data Reset — backup
 *
 * Before anything is deleted, the affected rows are exported to timestamped
 * JSON files (one per table) under `data-reset-backups/`. This preserves
 * enough information to investigate or restore an accidental deletion and
 * satisfies the "backup before deletion" requirement even when no automated
 * full-database backup is configured.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { BACKUP_DIR, quoteTable } from './config';
import { resolveStepCondition, type ResetDb, type ResetPlan } from './plan';

export interface BackupResult {
  directory: string;
  files: string[];
  records: number;
}

/**
 * Export every row scheduled for deletion to JSON files. Returns the backup
 * directory, written file names, and total record count. Uses only the ids
 * already collected by the plan, so a dry-run and an execute always agree.
 */
export async function writeResetBackup(
  db: ResetDb,
  plan: ResetPlan,
): Promise<BackupResult> {
  const timestamp = plan.timestamp;
  const tenantSlug = `${plan.tenantCode || plan.tenantId.slice(0, 8)}`.toLowerCase();
  const directory = path.join(BACKUP_DIR, `${timestamp}-${tenantSlug}`);
  await mkdir(directory, { recursive: true });

  const files: string[] = [];
  let records = 0;

  // Export transport requests + trips + generated documents fully (these are
  // the parent rows most likely to be needed for investigation).
  for (const table of ['transport_requests', 'trips', 'generated_documents']) {
    const rows = await exportTableRows(db, plan, table);
    if (rows.length === 0) continue;
    const file = path.join(directory, `${table}.json`);
    await writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
    files.push(file);
    records += rows.length;
  }

  // Export the remaining child tables (id + label columns only, compact).
  for (const step of plan.steps) {
    if (step.before === 0) continue;
    if (['transport_requests', 'trips', 'generated_documents'].includes(step.table)) continue;
    const rows = await exportTableRows(db, plan, step.table);
    if (rows.length === 0) continue;
    const file = path.join(directory, `${step.table}.json`);
    await writeFile(file, JSON.stringify(rows, null, 2), 'utf8');
    files.push(file);
    records += rows.length;
  }

  // Manifest for the whole backup.
  const manifest = {
    tool: 'grn-fleet-development-data-reset',
    timestamp,
    tenantId: plan.tenantId,
    tenantName: plan.tenantName,
    tenantCode: plan.tenantCode,
    mode: plan.mode,
    database: plan.database,
    files,
    records,
    note: 'JSON exports of rows scheduled for deletion. Use for investigation/restore only.',
  };
  const manifestFile = path.join(directory, 'backup-manifest.json');
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2), 'utf8');
  files.push(manifestFile);

  return { directory, files, records };
}

async function exportTableRows(
  db: ResetDb,
  plan: ResetPlan,
  table: string,
): Promise<Array<Record<string, unknown>>> {
  const step = plan.steps.find((s) => s.table === table);
  if (!step || step.before === 0) {
    // transport_requests/trips/generated_documents are always in the steps
    // list, so this only triggers for genuinely unknown tables.
    return [];
  }
  const condition = resolveStepCondition(
    { table: step.table, label: step.label, scope: step.scope, fileKeyColumns: step.fileKeyColumns },
    plan.ids,
    plan.tenantId,
  );
  if (!condition) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = sql`SELECT * FROM ${sql.raw(quoteTable(table))} WHERE ${condition}` as any;
  const result = await db.execute(query);
  return result.rows ?? [];
}
