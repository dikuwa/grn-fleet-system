import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
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
import { recordAuditEvent } from '@/lib/audit-event';
import { matchesPlatformExecutionResetPhrase } from '@/lib/reset-workflow';
import {
  createPlatformOperationalBackup,
  platformOperationalResetFingerprint,
  readPlatformOperationalBackup,
  PLATFORM_OPERATIONAL_PRESERVED,
  type PlatformBackupPayload,
} from './platform-reset-service';

type SnapshotTable = PlatformBackupPayload['tables'][number];
// The repository exposes one Drizzle-style surface over both the default DB
// facade and transaction executors. The snapshot helper intentionally accepts
// either so verification and deletion can use the same locked transaction.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SnapshotExecutor = any;

function canonicalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function platformOperationalSnapshotFingerprint(tables: SnapshotTable[]) {
  const normalized = [...tables]
    .map((entry) => ({
      table: entry.table,
      rows: entry.rows
        .map((row) => canonicalize(row))
        .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
    }))
    .sort((left, right) => left.table.localeCompare(right.table));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export async function capturePlatformOperationalSnapshot(
  executor: SnapshotExecutor = getDb(),
) {
  const [enquiryRows, demoIdRows] = await Promise.all([
    executor.select().from(cmsEnquiries),
    executor
      .select({ id: demoRequests.id })
      .from(demoRequests)
      .leftJoin(demoSandboxes, eq(demoSandboxes.demoRequestId, demoRequests.id))
      .where(isNull(demoSandboxes.id)),
  ]);
  const demoRequestIds = demoIdRows.map((row: { id: string }) => row.id);
  const demoRequestRows = demoRequestIds.length
    ? await executor
        .select()
        .from(demoRequests)
        .where(inArray(demoRequests.id, demoRequestIds))
    : [];
  const enquiryIds = enquiryRows.map((row: typeof cmsEnquiries.$inferSelect) => row.id);
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
  const notificationRows = await executor
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.workspace, 'platform_admin'), or(...disposableNotificationConditions)),
    );
  const notificationIds = notificationRows.map((row: typeof notifications.$inferSelect) => row.id);

  const [deliveryRows, readRows, dismissalRows] = notificationIds.length
    ? await Promise.all([
        executor
          .select()
          .from(notificationDeliveries)
          .where(inArray(notificationDeliveries.notificationId, notificationIds)),
        executor
          .select()
          .from(notificationReads)
          .where(inArray(notificationReads.notificationId, notificationIds)),
        executor
          .select()
          .from(notificationDismissals)
          .where(inArray(notificationDismissals.notificationId, notificationIds)),
      ])
    : [[], [], []];

  const tables: SnapshotTable[] = [
    {
      table: 'cms_enquiries',
      rows: enquiryRows as unknown as Array<Record<string, unknown>>,
    },
    {
      table: 'demo_requests',
      rows: demoRequestRows as unknown as Array<Record<string, unknown>>,
    },
    {
      table: 'notifications',
      rows: notificationRows as unknown as Array<Record<string, unknown>>,
    },
    {
      table: 'notification_deliveries',
      rows: deliveryRows as unknown as Array<Record<string, unknown>>,
    },
    {
      table: 'notification_reads',
      rows: readRows as unknown as Array<Record<string, unknown>>,
    },
    {
      table: 'notification_dismissals',
      rows: dismissalRows as unknown as Array<Record<string, unknown>>,
    },
  ];
  const counts = {
    enquiries: enquiryRows.length,
    demoRequests: demoRequestRows.length,
    notifications: notificationRows.length,
    notificationDeliveries: deliveryRows.length,
    notificationReads: readRows.length,
    notificationDismissals: dismissalRows.length,
    total:
      enquiryRows.length +
      demoRequestRows.length +
      notificationRows.length +
      deliveryRows.length +
      readRows.length +
      dismissalRows.length,
  };
  return {
    tables,
    counts,
    ids: { enquiryIds, demoRequestIds, notificationIds },
    planFingerprint: platformOperationalResetFingerprint({
      enquiryIds,
      demoRequestIds,
      notificationIds,
    }),
    snapshotFingerprint: platformOperationalSnapshotFingerprint(tables),
  };
}

export async function createVerifiedPlatformOperationalBackup(input: {
  actorUserId: string;
  expectedFingerprint: string;
}) {
  const backup = await createPlatformOperationalBackup(input);
  const { payload } = await readPlatformOperationalBackup(backup.id);
  const backupChecksum = backup.checksum;
  if (!backupChecksum) throw new Error('Platform recovery archive checksum is missing');
  const archiveSnapshotFingerprint = platformOperationalSnapshotFingerprint(payload.tables);
  const db = getDb();
  const verification = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('govfleet-platform-operational-backup-snapshot'))`,
    );
    await tx.execute(
      sql.raw(
        'LOCK TABLE platform_backups, cms_enquiries, demo_requests, demo_sandboxes, notifications, notification_deliveries, notification_reads, notification_dismissals IN SHARE ROW EXCLUSIVE MODE',
      ),
    );

    const [currentBackup] = await tx
      .select({
        status: platformBackups.status,
        storageKey: platformBackups.storageKey,
        checksum: platformBackups.checksum,
      })
      .from(platformBackups)
      .where(eq(platformBackups.id, backup.id))
      .limit(1);
    if (
      !currentBackup ||
      currentBackup.status !== 'ready' ||
      !currentBackup.storageKey ||
      currentBackup.checksum !== backupChecksum
    ) {
      return {
        ok: false as const,
        reason: 'The platform recovery point changed before snapshot verification could finish.',
      };
    }

    const current = await capturePlatformOperationalSnapshot(tx);
    if (
      current.planFingerprint !== input.expectedFingerprint ||
      current.snapshotFingerprint !== archiveSnapshotFingerprint
    ) {
      const reason =
        'Platform operational data changed while the recovery point was being created. Refresh the impact preview and create a fresh recovery point.';
      const [failed] = await tx
        .update(platformBackups)
        .set({
          status: 'failed',
          isProtected: false,
          failureReason: reason,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(platformBackups.id, backup.id),
            eq(platformBackups.status, 'ready'),
            eq(platformBackups.checksum, backupChecksum),
          ),
        )
        .returning({ id: platformBackups.id });
      return {
        ok: false as const,
        reason: failed
          ? reason
          : 'The platform recovery point changed while snapshot verification was finalizing.',
      };
    }

    const verifiedAt = new Date();
    const [verified] = await tx
      .update(platformBackups)
      .set({
        recordCount: current.counts.total,
        metadata: sql`COALESCE(${platformBackups.metadata}, '{}'::jsonb) || jsonb_build_object(
          'platformSnapshotVersion', 2,
          'platformSnapshotFingerprint', ${archiveSnapshotFingerprint},
          'platformSnapshotVerifiedAt', ${verifiedAt.toISOString()},
          'counts', jsonb_build_object(
            'enquiries', ${current.counts.enquiries},
            'demoRequests', ${current.counts.demoRequests},
            'notifications', ${current.counts.notifications},
            'notificationDeliveries', ${current.counts.notificationDeliveries},
            'notificationReads', ${current.counts.notificationReads},
            'notificationDismissals', ${current.counts.notificationDismissals},
            'total', ${current.counts.total}
          )
        )`,
        updatedAt: verifiedAt,
      })
      .where(
        and(
          eq(platformBackups.id, backup.id),
          eq(platformBackups.status, 'ready'),
          eq(platformBackups.checksum, backupChecksum),
        ),
      )
      .returning();
    if (!verified) {
      return {
        ok: false as const,
        reason: 'The platform recovery point changed while snapshot verification was finalizing.',
      };
    }
    return { ok: true as const, backup: verified };
  });

  if (!verification.ok) throw new Error(verification.reason);
  return verification.backup;
}

export async function executeVerifiedPlatformOperationalReset(input: {
  actorUserId: string;
  actorTenantId: string;
  expectedFingerprint: string;
  backupId: string;
  confirmationPhrase: string;
}) {
  if (!matchesPlatformExecutionResetPhrase(input.confirmationPhrase)) {
    throw new Error('Type exactly: RESET PLATFORM');
  }

  const { backup, payload } = await readPlatformOperationalBackup(input.backupId);
  const backupChecksum = backup.checksum;
  if (!backupChecksum) throw new Error('Platform recovery archive checksum is missing');
  if (payload.fingerprint !== input.expectedFingerprint) {
    throw new Error('Recovery point does not match the current platform reset plan');
  }
  const backupMetadata = (backup.metadata ?? {}) as Record<string, unknown>;
  const storedSnapshotFingerprint =
    typeof backupMetadata.platformSnapshotFingerprint === 'string'
      ? backupMetadata.platformSnapshotFingerprint
      : null;
  if (backupMetadata.platformSnapshotVersion !== 2 || !storedSnapshotFingerprint) {
    throw new Error(
      'Create a fresh verified platform recovery point before executing this reset.',
    );
  }
  const archiveSnapshotFingerprint = platformOperationalSnapshotFingerprint(payload.tables);
  if (archiveSnapshotFingerprint !== storedSnapshotFingerprint) {
    throw new Error('Platform recovery archive does not match its verified snapshot fingerprint');
  }

  const db = getDb();
  const current = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('govfleet-platform-operational-reset-snapshot'))`,
    );
    await tx.execute(
      sql.raw(
        'LOCK TABLE platform_backups, cms_enquiries, demo_requests, demo_sandboxes, notifications, notification_deliveries, notification_reads, notification_dismissals IN SHARE ROW EXCLUSIVE MODE',
      ),
    );

    const [currentBackup] = await tx
      .select({
        status: platformBackups.status,
        storageKey: platformBackups.storageKey,
        checksum: platformBackups.checksum,
        metadata: platformBackups.metadata,
      })
      .from(platformBackups)
      .where(eq(platformBackups.id, input.backupId))
      .limit(1);
    const currentMetadata = (currentBackup?.metadata ?? {}) as Record<string, unknown>;
    if (
      !currentBackup ||
      currentBackup.status !== 'ready' ||
      !currentBackup.storageKey ||
      currentBackup.checksum !== backupChecksum ||
      currentMetadata.platformSnapshotVersion !== 2 ||
      currentMetadata.platformSnapshotFingerprint !== storedSnapshotFingerprint
    ) {
      throw new Error('The verified platform recovery point changed before execution could start.');
    }

    const snapshot = await capturePlatformOperationalSnapshot(tx);
    if (
      snapshot.planFingerprint !== input.expectedFingerprint ||
      snapshot.snapshotFingerprint !== storedSnapshotFingerprint
    ) {
      throw new Error(
        'Platform operational data changed after the recovery point was created. Refresh the impact preview and create a fresh recovery point.',
      );
    }

    if (snapshot.ids.notificationIds.length) {
      await tx
        .delete(notificationDeliveries)
        .where(inArray(notificationDeliveries.notificationId, snapshot.ids.notificationIds));
      await tx
        .delete(notificationReads)
        .where(inArray(notificationReads.notificationId, snapshot.ids.notificationIds));
      await tx
        .delete(notificationDismissals)
        .where(inArray(notificationDismissals.notificationId, snapshot.ids.notificationIds));
      await tx.delete(notifications).where(inArray(notifications.id, snapshot.ids.notificationIds));
    }
    if (snapshot.ids.demoRequestIds.length) {
      await tx.delete(demoRequests).where(inArray(demoRequests.id, snapshot.ids.demoRequestIds));
    }
    if (snapshot.ids.enquiryIds.length) {
      await tx.delete(cmsEnquiries).where(inArray(cmsEnquiries.id, snapshot.ids.enquiryIds));
    }
    return snapshot;
  });

  await recordAuditEvent({
    tenantId: input.actorTenantId,
    actorUserId: input.actorUserId,
    action: 'platform_operational_reset.executed',
    entityType: 'platform_backup',
    entityId: backup.id,
    summary: `Platform operational reset completed; ${current.counts.total} records removed; recovery point ${backup.id} retained.`,
    after: {
      counts: current.counts,
      fingerprint: current.planFingerprint,
      snapshotFingerprint: current.snapshotFingerprint,
      backupId: backup.id,
      preserved: PLATFORM_OPERATIONAL_PRESERVED,
    },
  });

  return {
    result: 'completed' as const,
    removed: current.counts,
    backupId: backup.id,
    preserved: PLATFORM_OPERATIONAL_PRESERVED,
  };
}