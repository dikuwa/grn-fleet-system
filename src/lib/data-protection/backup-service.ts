import { createHash } from 'node:crypto';
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackups, platformBackupSchedules } from '@/db/schema/data-protection';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { tenants } from '@/db/schema/tenants';
import { buildResetPlan, resolveStepCondition, type ResetDb, type ResetPlan } from '@/lib/data-reset/plan';
import { quoteTable } from '@/lib/data-reset/config';
import { downloadFile, getSignedFileUrl, isStorageConfigured, uploadFile, deleteFile } from '@/lib/storage';

export type BackupSource = 'manual' | 'scheduled' | 'pre_reset';

interface CreateBackupInput {
  tenantId: string;
  source: BackupSource;
  reason?: string;
  createdByUserId?: string | null;
  resetRequestId?: string | null;
  retentionDays?: number;
  plan?: ResetPlan;
}

interface BackupPayload {
  formatVersion: 1;
  type: 'govfleet-tenant-operational-backup';
  snapshotId: string;
  createdAt: string;
  tenant: { id: string; name: string; code: string };
  resetRequestId: string | null;
  mode: 'operational';
  fileObjectsPreserved: true;
  preserved: ResetPlan['preserved'];
  tables: Array<{ table: string; label: string; rows: Array<Record<string, unknown>> }>;
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

async function exportRows(db: ResetDb, plan: ResetPlan, table: string) {
  const step = plan.steps.find((candidate) => candidate.table === table);
  if (!step || step.before === 0) return [] as Array<Record<string, unknown>>;
  const condition = resolveStepCondition(step, plan.ids, plan.tenantId);
  if (!condition) return [] as Array<Record<string, unknown>>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = sql`SELECT * FROM ${sql.raw(quoteTable(table))} WHERE ${condition}` as any;
  const result = await db.execute(query);
  return (result.rows ?? []) as Array<Record<string, unknown>>;
}

export async function createTenantOperationalBackup(input: CreateBackupInput) {
  if (!isStorageConfigured()) {
    throw new Error('Durable backup storage is not configured. Configure the existing R2/S3 storage credentials before a production reset can run.');
  }

  const db = getDb();
  const [tenant] = await db.select({ id: tenants.id, name: tenants.name, code: tenants.code }).from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  if (!tenant) throw new Error('Tenant not found');

  const retentionDays = Math.min(3650, Math.max(1, input.retentionDays ?? (input.source === 'pre_reset' ? 90 : 30)));
  const expiresAt = new Date(Date.now() + retentionDays * 86_400_000);
  const [snapshot] = await db.insert(platformBackups).values({
    tenantId: tenant.id,
    resetRequestId: input.resetRequestId ?? null,
    scope: 'tenant_operational',
    source: input.source,
    reason: input.reason ?? null,
    status: 'creating',
    retentionDays,
    expiresAt,
    isProtected: input.source === 'pre_reset',
    createdByUserId: input.createdByUserId ?? null,
  }).returning();

  try {
    const plan = input.plan ?? await buildResetPlan(db as unknown as ResetDb, {
      tenantId: tenant.id,
      mode: 'operational',
      dryRun: false,
      timestamp: new Date().toISOString().replace(/[:.]/g, '-'),
    });

    const tables: BackupPayload['tables'] = [];
    let recordCount = 0;
    for (const step of plan.steps) {
      if (step.before === 0) continue;
      const rows = await exportRows(db as unknown as ResetDb, plan, step.table);
      if (!rows.length) continue;
      recordCount += rows.length;
      tables.push({ table: step.table, label: step.label, rows });
    }

    const payload: BackupPayload = {
      formatVersion: 1,
      type: 'govfleet-tenant-operational-backup',
      snapshotId: snapshot.id,
      createdAt: new Date().toISOString(),
      tenant,
      resetRequestId: input.resetRequestId ?? null,
      mode: 'operational',
      fileObjectsPreserved: true,
      preserved: plan.preserved,
      tables,
    };

    const json = JSON.stringify(payload, jsonReplacer);
    const buffer = Buffer.from(json, 'utf8');
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const safeCode = (tenant.code || tenant.id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const storageKey = `backups/tenants/${safeCode}/${snapshot.id}.json`;
    const upload = await uploadFile(buffer, storageKey, { contentType: 'application/json' });

    const [ready] = await db.update(platformBackups).set({
      status: 'ready',
      storageKey: upload.key,
      checksum,
      sizeBytes: upload.size,
      recordCount,
      metadata: {
        formatVersion: 1,
        fileObjectsPreserved: true,
        plannedRows: plan.steps.reduce((sum, step) => sum + step.before, 0),
      },
      updatedAt: new Date(),
    }).where(eq(platformBackups.id, snapshot.id)).returning();

    if (input.resetRequestId) {
      await db.update(tenantResetRequests).set({
        backupCreated: true,
        backupLocation: upload.key,
        backupSizeBytes: upload.size,
        backupRecordCount: recordCount,
        rollbackPossible: true,
        metadata: {
          backupSnapshotId: snapshot.id,
          backupChecksum: checksum,
          backupCreatedAt: new Date().toISOString(),
          backupStorage: 'r2',
          fileObjectsPreserved: true,
        },
        updatedAt: new Date(),
      }).where(eq(tenantResetRequests.id, input.resetRequestId));
    }

    return ready;
  } catch (error) {
    await db.update(platformBackups).set({
      status: 'failed',
      failureReason: error instanceof Error ? error.message : String(error),
      updatedAt: new Date(),
    }).where(eq(platformBackups.id, snapshot.id));
    throw error;
  }
}

export async function listBackups(limit = 100) {
  const db = getDb();
  return db.select({
    id: platformBackups.id,
    tenantId: platformBackups.tenantId,
    tenantName: tenants.name,
    tenantCode: tenants.code,
    resetRequestId: platformBackups.resetRequestId,
    scope: platformBackups.scope,
    source: platformBackups.source,
    reason: platformBackups.reason,
    status: platformBackups.status,
    storageKey: platformBackups.storageKey,
    checksum: platformBackups.checksum,
    sizeBytes: platformBackups.sizeBytes,
    recordCount: platformBackups.recordCount,
    retentionDays: platformBackups.retentionDays,
    expiresAt: platformBackups.expiresAt,
    isProtected: platformBackups.isProtected,
    restoredAt: platformBackups.restoredAt,
    failureReason: platformBackups.failureReason,
    createdAt: platformBackups.createdAt,
  }).from(platformBackups).leftJoin(tenants, eq(platformBackups.tenantId, tenants.id)).orderBy(desc(platformBackups.createdAt)).limit(limit);
}

export async function getBackupDownloadUrl(backupId: string) {
  const db = getDb();
  const [backup] = await db.select().from(platformBackups).where(eq(platformBackups.id, backupId)).limit(1);
  if (!backup || backup.status !== 'ready' || !backup.storageKey) throw new Error('Backup is not available for download');
  const url = await getSignedFileUrl(backup.storageKey, 900);
  if (!url) throw new Error('Backup storage is not available');
  return { backup, url };
}

export async function setBackupProtection(backupId: string, isProtected: boolean) {
  const db = getDb();
  const [updated] = await db.update(platformBackups).set({ isProtected, updatedAt: new Date() }).where(eq(platformBackups.id, backupId)).returning();
  if (!updated) throw new Error('Backup not found');
  return updated;
}

export async function deleteBackup(backupId: string) {
  const db = getDb();
  const [backup] = await db.select().from(platformBackups).where(eq(platformBackups.id, backupId)).limit(1);
  if (!backup) throw new Error('Backup not found');
  if (backup.isProtected) throw new Error('Protected backups must be unprotected before deletion');
  if (backup.storageKey) await deleteFile(backup.storageKey);
  await db.update(platformBackups).set({ status: 'deleted', storageKey: null, updatedAt: new Date() }).where(eq(platformBackups.id, backupId));
}

async function bodyToText(body: ReadableStream | null) {
  if (!body) throw new Error('Backup archive is empty');
  const enhanced = body as ReadableStream & { transformToString?: () => Promise<string> };
  if (typeof enhanced.transformToString === 'function') return enhanced.transformToString();
  return new Response(body).text();
}

export async function readBackupPayload(backupId: string): Promise<{ backup: typeof platformBackups.$inferSelect; payload: BackupPayload }> {
  const db = getDb();
  const [backup] = await db.select().from(platformBackups).where(eq(platformBackups.id, backupId)).limit(1);
  if (!backup || backup.status !== 'ready' || !backup.storageKey) throw new Error('Backup is not ready');
  const file = await downloadFile(backup.storageKey);
  if (!file) throw new Error('Backup archive could not be found in durable storage');
  const text = await bodyToText(file.body);
  const checksum = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  if (backup.checksum && checksum !== backup.checksum) throw new Error('Backup integrity check failed: checksum mismatch');
  const payload = JSON.parse(text) as BackupPayload;
  if (payload.formatVersion !== 1 || payload.type !== 'govfleet-tenant-operational-backup') throw new Error('Unsupported backup format');
  if (backup.tenantId && payload.tenant.id !== backup.tenantId) throw new Error('Backup tenant identity mismatch');
  return { backup, payload };
}

export function nextScheduleRun(frequency: string, from = new Date()) {
  const next = new Date(from);
  next.setUTCHours(2, 30, 0, 0);
  if (frequency === 'daily') next.setUTCDate(next.getUTCDate() + 1);
  else if (frequency === 'weekly') next.setUTCDate(next.getUTCDate() + 7);
  else next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

export async function dueBackupSchedules(now = new Date()) {
  const db = getDb();
  return db.select().from(platformBackupSchedules).where(and(eq(platformBackupSchedules.enabled, true), lte(platformBackupSchedules.nextRunAt, now)));
}

export async function expireOldBackups(now = new Date()) {
  const db = getDb();
  const expired = await db.select().from(platformBackups).where(and(eq(platformBackups.status, 'ready'), eq(platformBackups.isProtected, false), lte(platformBackups.expiresAt, now)));
  for (const backup of expired) {
    if (backup.storageKey) await deleteFile(backup.storageKey).catch(() => undefined);
    await db.update(platformBackups).set({ status: 'expired', storageKey: null, updatedAt: new Date() }).where(eq(platformBackups.id, backup.id));
  }
  return expired.length;
}

export async function activeBackupSchedules() {
  const db = getDb();
  return db.select({
    id: platformBackupSchedules.id,
    tenantId: platformBackupSchedules.tenantId,
    tenantName: tenants.name,
    frequency: platformBackupSchedules.frequency,
    retentionDays: platformBackupSchedules.retentionDays,
    enabled: platformBackupSchedules.enabled,
    lastRunAt: platformBackupSchedules.lastRunAt,
    nextRunAt: platformBackupSchedules.nextRunAt,
  }).from(platformBackupSchedules).leftJoin(tenants, eq(platformBackupSchedules.tenantId, tenants.id)).where(or(eq(platformBackupSchedules.enabled, true), isNull(platformBackupSchedules.lastRunAt))).orderBy(platformBackupSchedules.nextRunAt);
}
