import { createHash } from 'node:crypto';
import { and, count, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  cmsEnquiries,
  demoRequests,
  demoSandboxes,
  notificationDeliveries,
  notificationDismissals,
  notificationReads,
  notifications,
  platformBackups,
} from '@/db/schema';
import { runAtomicMutations } from '@/lib/db-atomic';
import { quoteTable } from '@/lib/data-reset/config';
import { recordAuditEvent } from '@/lib/audit-event';
import { downloadFile, isStorageConfigured, uploadFile } from '@/lib/storage';
import {
  BACKUP_STORAGE_TIMEOUT_MS,
  failStaleCreatingBackups,
  withinBackupDeadline,
} from './backup-service';
import { matchesPlatformExecutionResetPhrase } from '@/lib/reset-workflow';

export const PLATFORM_OPERATIONAL_PRESERVED = [
  'Platform users and roles',
  'Tenants and tenant operational data',
  'Demo sandboxes',
  'Subscriptions, packages and billing',
  'Payments and financial records',
  'CMS content, media and site settings',
  'Open Platform Admin action-required notifications',
  'Backup and reset history',
  'Audit events',
] as const;

export const PLATFORM_OPERATIONAL_TABLES = [
  'cms_enquiries',
  'demo_requests',
  'notifications',
  'notification_deliveries',
  'notification_reads',
  'notification_dismissals',
] as const;

export interface PlatformOperationalResetPlan {
  ids: {
    enquiryIds: string[];
    demoRequestIds: string[];
    notificationIds: string[];
  };
  counts: {
    enquiries: number;
    demoRequests: number;
    notifications: number;
    notificationDeliveries: number;
    notificationReads: number;
    notificationDismissals: number;
    total: number;
  };
  fingerprint: string;
  plannedAt: string;
  preserved: readonly string[];
}

export function platformOperationalResetFingerprint(ids: PlatformOperationalResetPlan['ids']) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        enquiryIds: [...ids.enquiryIds].sort(),
        demoRequestIds: [...ids.demoRequestIds].sort(),
        notificationIds: [...ids.notificationIds].sort(),
      }),
    )
    .digest('hex');
}

export async function previewPlatformOperationalReset(): Promise<PlatformOperationalResetPlan> {
  const db = getDb();
  const [enquiryRows, demoRows] = await Promise.all([
    db.select({ id: cmsEnquiries.id }).from(cmsEnquiries),
    db
      .select({ id: demoRequests.id })
      .from(demoRequests)
      .leftJoin(demoSandboxes, eq(demoSandboxes.demoRequestId, demoRequests.id))
      .where(isNull(demoSandboxes.id)),
  ]);
  const enquiryIds = enquiryRows.map((row) => row.id);
  const demoRequestIds = demoRows.map((row) => row.id);
  const entityIds = [...enquiryIds, ...demoRequestIds];
  const disposableNotificationConditions = [
    inArray(notifications.status, ['resolved', 'dismissed', 'archived']),
  ];
  if (entityIds.length) {
    disposableNotificationConditions.push(
      and(
        inArray(notifications.entityId, entityIds),
        inArray(notifications.entityType, ['public_enquiry', 'demo_request']),
      )!,
    );
  }
  const notificationRows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(eq(notifications.workspace, 'platform_admin'), or(...disposableNotificationConditions)),
    );
  const notificationIds = notificationRows.map((row) => row.id);

  let notificationDeliveryCount = 0;
  let notificationReadCount = 0;
  let notificationDismissalCount = 0;
  if (notificationIds.length) {
    const [deliveries, reads, dismissals] = await Promise.all([
      db
        .select({ count: count() })
        .from(notificationDeliveries)
        .where(inArray(notificationDeliveries.notificationId, notificationIds)),
      db
        .select({ count: count() })
        .from(notificationReads)
        .where(inArray(notificationReads.notificationId, notificationIds)),
      db
        .select({ count: count() })
        .from(notificationDismissals)
        .where(inArray(notificationDismissals.notificationId, notificationIds)),
    ]);
    notificationDeliveryCount = Number(deliveries[0]?.count ?? 0);
    notificationReadCount = Number(reads[0]?.count ?? 0);
    notificationDismissalCount = Number(dismissals[0]?.count ?? 0);
  }

  const ids = { enquiryIds, demoRequestIds, notificationIds };
  const counts = {
    enquiries: enquiryIds.length,
    demoRequests: demoRequestIds.length,
    notifications: notificationIds.length,
    notificationDeliveries: notificationDeliveryCount,
    notificationReads: notificationReadCount,
    notificationDismissals: notificationDismissalCount,
    total:
      enquiryIds.length +
      demoRequestIds.length +
      notificationIds.length +
      notificationDeliveryCount +
      notificationReadCount +
      notificationDismissalCount,
  };
  return {
    ids,
    counts,
    fingerprint: platformOperationalResetFingerprint(ids),
    plannedAt: new Date().toISOString(),
    preserved: PLATFORM_OPERATIONAL_PRESERVED,
  };
}

export type PlatformBackupPayload = {
  formatVersion: 1;
  type: 'govfleet-platform-operational-backup';
  snapshotId: string;
  createdAt: string;
  fingerprint: string;
  tables: Array<{ table: string; rows: Array<Record<string, unknown>> }>;
};

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === 'bigint' ? value.toString() : value;
}

export async function createPlatformOperationalBackup(input: {
  actorUserId: string;
  expectedFingerprint: string;
}) {
  if (!isStorageConfigured()) throw new Error('Durable backup storage is not configured');
  await failStaleCreatingBackups();
  const plan = await previewPlatformOperationalReset();
  if (plan.fingerprint !== input.expectedFingerprint)
    throw new Error('Platform operational data changed. Refresh the impact preview.');
  const db = getDb();
  const [snapshot] = await db
    .insert(platformBackups)
    .values({
      tenantId: null,
      resetRequestId: null,
      scope: 'platform_operational',
      source: 'pre_reset',
      reason: 'Pre-reset recovery point for platform operational data',
      status: 'creating',
      retentionDays: 90,
      expiresAt: new Date(Date.now() + 90 * 86_400_000),
      isProtected: true,
      createdByUserId: input.actorUserId,
      metadata: { fingerprint: plan.fingerprint, counts: plan.counts },
    })
    .returning();
  const deadlineAt = Date.now() + BACKUP_STORAGE_TIMEOUT_MS;

  try {
    const [enquiryRows, demoRows, notificationRows, deliveryRows, readRows, dismissalRows] =
      await withinBackupDeadline(
        Promise.all([
          plan.ids.enquiryIds.length
            ? db.select().from(cmsEnquiries).where(inArray(cmsEnquiries.id, plan.ids.enquiryIds))
            : [],
          plan.ids.demoRequestIds.length
            ? db
                .select()
                .from(demoRequests)
                .where(inArray(demoRequests.id, plan.ids.demoRequestIds))
            : [],
          plan.ids.notificationIds.length
            ? db
                .select()
                .from(notifications)
                .where(inArray(notifications.id, plan.ids.notificationIds))
            : [],
          plan.ids.notificationIds.length
            ? db
                .select()
                .from(notificationDeliveries)
                .where(inArray(notificationDeliveries.notificationId, plan.ids.notificationIds))
            : [],
          plan.ids.notificationIds.length
            ? db
                .select()
                .from(notificationReads)
                .where(inArray(notificationReads.notificationId, plan.ids.notificationIds))
            : [],
          plan.ids.notificationIds.length
            ? db
                .select()
                .from(notificationDismissals)
                .where(inArray(notificationDismissals.notificationId, plan.ids.notificationIds))
            : [],
        ]),
        deadlineAt,
      );
    const payload: PlatformBackupPayload = {
      formatVersion: 1,
      type: 'govfleet-platform-operational-backup',
      snapshotId: snapshot.id,
      createdAt: new Date().toISOString(),
      fingerprint: plan.fingerprint,
      tables: [
        { table: 'cms_enquiries', rows: enquiryRows as Array<Record<string, unknown>> },
        { table: 'demo_requests', rows: demoRows as Array<Record<string, unknown>> },
        { table: 'notifications', rows: notificationRows as Array<Record<string, unknown>> },
        { table: 'notification_deliveries', rows: deliveryRows as Array<Record<string, unknown>> },
        { table: 'notification_reads', rows: readRows as Array<Record<string, unknown>> },
        { table: 'notification_dismissals', rows: dismissalRows as Array<Record<string, unknown>> },
      ],
    };
    const buffer = Buffer.from(JSON.stringify(payload, jsonReplacer), 'utf8');
    const checksum = createHash('sha256').update(buffer).digest('hex');
    const remainingStorageMs = Math.max(1, deadlineAt - Date.now());
    const upload = await uploadFile(buffer, `backups/platform/${snapshot.id}.json`, {
      contentType: 'application/json',
      timeoutMs: remainingStorageMs,
    });
    const [ready] = await db
      .update(platformBackups)
      .set({
        status: 'ready',
        storageKey: upload.key,
        checksum,
        sizeBytes: upload.size,
        recordCount: plan.counts.total,
        updatedAt: new Date(),
      })
      .where(eq(platformBackups.id, snapshot.id))
      .returning();
    return ready;
  } catch (error) {
    await db
      .update(platformBackups)
      .set({
        status: 'failed',
        failureReason: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(platformBackups.id, snapshot.id));
    throw error;
  }
}

export async function readPlatformOperationalBackup(backupId: string) {
  const deadlineAt = Date.now() + BACKUP_STORAGE_TIMEOUT_MS;
  const db = getDb();
  const [backup] = await db
    .select()
    .from(platformBackups)
    .where(eq(platformBackups.id, backupId))
    .limit(1);
  if (
    !backup ||
    backup.scope !== 'platform_operational' ||
    backup.status !== 'ready' ||
    !backup.storageKey
  )
    throw new Error('Verified platform recovery point not found');
  const file = await withinBackupDeadline(
    downloadFile(backup.storageKey, { timeoutMs: BACKUP_STORAGE_TIMEOUT_MS }),
    deadlineAt,
  );
  if (!file) throw new Error('Platform recovery archive could not be downloaded');
  if (!file.body) throw new Error('Platform recovery archive is empty');
  const enhancedBody = file.body as ReadableStream & {
    transformToString?: () => Promise<string>;
  };
  const text =
    typeof enhancedBody.transformToString === 'function'
      ? await withinBackupDeadline(enhancedBody.transformToString(), deadlineAt)
      : await withinBackupDeadline(new Response(file.body).text(), deadlineAt);
  const checksum = createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');
  if (checksum !== backup.checksum) throw new Error('Platform recovery archive checksum failed');
  const payload = JSON.parse(text) as PlatformBackupPayload;
  if (payload.formatVersion !== 1 || payload.type !== 'govfleet-platform-operational-backup')
    throw new Error('Platform recovery archive is invalid');
  const metadata = (backup.metadata ?? {}) as Record<string, unknown>;
  if (metadata.fingerprint !== payload.fingerprint)
    throw new Error('Platform recovery archive does not match its database record');
  return { backup, payload };
}

async function verifyPlatformBackup(backupId: string, fingerprintValue: string) {
  const result = await readPlatformOperationalBackup(backupId);
  if (result.payload.fingerprint !== fingerprintValue)
    throw new Error('Recovery point does not match the current platform reset plan');
  return result.backup;
}

export async function executePlatformOperationalReset(input: {
  actorUserId: string;
  actorTenantId: string;
  expectedFingerprint: string;
  backupId: string;
  confirmationPhrase: string;
}) {
  if (!matchesPlatformExecutionResetPhrase(input.confirmationPhrase))
    throw new Error('Type exactly: RESET PLATFORM');
  const plan = await previewPlatformOperationalReset();
  if (plan.fingerprint !== input.expectedFingerprint)
    throw new Error(
      'Platform operational data changed. Refresh the impact preview and recovery point.',
    );
  const backup = await verifyPlatformBackup(input.backupId, plan.fingerprint);

  await runAtomicMutations((db) => {
    const mutations: Array<PromiseLike<unknown>> = [];
    if (plan.ids.notificationIds.length) {
      mutations.push(
        db
          .delete(notificationDeliveries)
          .where(inArray(notificationDeliveries.notificationId, plan.ids.notificationIds)),
      );
      mutations.push(
        db
          .delete(notificationReads)
          .where(inArray(notificationReads.notificationId, plan.ids.notificationIds)),
      );
      mutations.push(
        db
          .delete(notificationDismissals)
          .where(inArray(notificationDismissals.notificationId, plan.ids.notificationIds)),
      );
      mutations.push(
        db.delete(notifications).where(inArray(notifications.id, plan.ids.notificationIds)),
      );
    }
    if (plan.ids.demoRequestIds.length)
      mutations.push(
        db.delete(demoRequests).where(inArray(demoRequests.id, plan.ids.demoRequestIds)),
      );
    if (plan.ids.enquiryIds.length)
      mutations.push(db.delete(cmsEnquiries).where(inArray(cmsEnquiries.id, plan.ids.enquiryIds)));
    return mutations;
  });

  await recordAuditEvent({
    tenantId: input.actorTenantId,
    actorUserId: input.actorUserId,
    action: 'platform_operational_reset.executed',
    entityType: 'platform_backup',
    entityId: backup.id,
    summary: `Platform operational reset completed; ${plan.counts.total} records removed; recovery point ${backup.id} retained.`,
    after: {
      counts: plan.counts,
      fingerprint: plan.fingerprint,
      backupId: backup.id,
      preserved: plan.preserved,
    },
  });
  return {
    result: 'completed' as const,
    removed: plan.counts,
    backupId: backup.id,
    preserved: plan.preserved,
  };
}

export async function restorePlatformOperationalBackup(input: {
  backupId: string;
  actorUserId: string;
  actorTenantId: string;
  confirmationPhrase: string;
}) {
  if (input.confirmationPhrase !== 'RESTORE PLATFORM') {
    throw new Error('Confirmation phrase is incorrect. Type exactly: RESTORE PLATFORM');
  }
  const db = getDb();
  const { backup, payload } = await readPlatformOperationalBackup(input.backupId);
  if (backup.restoredAt) throw new Error('This recovery point has already been restored');

  const current = await previewPlatformOperationalReset();
  if (current.counts.total > 0) {
    throw new Error(
      `Restore blocked: ${current.counts.total} current platform operational rows exist. Clear them through Platform Operational Reset before restoring this recovery point.`,
    );
  }

  const rowsByTable = new Map(payload.tables.map((entry) => [entry.table, entry.rows]));
  const restored: Array<{ table: string; records: number }> = [];
  for (const table of PLATFORM_OPERATIONAL_TABLES) {
    const rows = rowsByTable.get(table) ?? [];
    if (!rows.length) continue;
    const json = JSON.stringify(rows, jsonReplacer).replace(/'/g, "''");
    await db.execute(
      sql.raw(
        `INSERT INTO ${quoteTable(table)} SELECT * FROM json_populate_recordset(NULL::${quoteTable(table)}, '${json}'::json)`,
      ),
    );
    restored.push({ table, records: rows.length });
  }

  const restoredAt = new Date();
  await db
    .update(platformBackups)
    .set({ restoredAt, restoredByUserId: input.actorUserId, updatedAt: restoredAt })
    .where(eq(platformBackups.id, backup.id));
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
