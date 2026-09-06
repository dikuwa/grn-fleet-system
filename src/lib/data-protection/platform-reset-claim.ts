import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackups } from '@/db/schema';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { deleteFile } from '@/lib/storage';
import { recoveryPointReleaseBlockReason } from './backup-policy';

const DEFAULT_PLATFORM_RESET_CLAIM_TTL_MINUTES = 10;
const MIN_PLATFORM_RESET_CLAIM_TTL_MINUTES = 6;
const PLATFORM_RESET_CLAIM_LOCK = 'govfleet-platform-operational-reset-claim';

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const PLATFORM_RESET_EXECUTION_CLAIM_TTL_MINUTES = Math.max(
  MIN_PLATFORM_RESET_CLAIM_TTL_MINUTES,
  positiveNumber(
    process.env.PLATFORM_RESET_EXECUTION_CLAIM_TTL_MINUTES,
    DEFAULT_PLATFORM_RESET_CLAIM_TTL_MINUTES,
  ),
);

export function hasLivePlatformResetExecutionClaim(
  metadata: unknown,
  now = new Date(),
) {
  const record = (metadata ?? {}) as Record<string, unknown>;
  const claimId =
    typeof record.platformExecutionClaimId === 'string'
      ? record.platformExecutionClaimId.trim()
      : '';
  const claimedAt =
    typeof record.platformExecutionClaimedAt === 'string'
      ? new Date(record.platformExecutionClaimedAt)
      : null;
  if (!claimId || !claimedAt || Number.isNaN(claimedAt.getTime())) return false;
  return (
    claimedAt.getTime() >=
    now.getTime() - PLATFORM_RESET_EXECUTION_CLAIM_TTL_MINUTES * 60 * 1000
  );
}

export async function assertNoActivePlatformResetExecutionClaim(backupId: string) {
  const db = getDb();
  const [backup] = await db
    .select({
      scope: platformBackups.scope,
      metadata: platformBackups.metadata,
    })
    .from(platformBackups)
    .where(eq(platformBackups.id, backupId))
    .limit(1);
  if (
    backup?.scope === 'platform_operational' &&
    hasLivePlatformResetExecutionClaim(backup.metadata)
  ) {
    throw new Error(
      'This platform recovery point is locked by an active operational reset and cannot be released yet.',
    );
  }
}

/**
 * Change backup protection while serializing platform unprotect with execution
 * claim acquisition. The shared advisory lock makes the existing recovery-point
 * release policy, live-claim check and protection update one atomic decision.
 */
export async function setBackupProtectionWithPlatformResetFence(
  backupId: string,
  isProtected: boolean,
) {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))`);

    const [backup] = await tx
      .select({
        id: platformBackups.id,
        scope: platformBackups.scope,
        metadata: platformBackups.metadata,
        isProtected: platformBackups.isProtected,
        status: platformBackups.status,
        source: platformBackups.source,
        expiresAt: platformBackups.expiresAt,
        resetRequestId: platformBackups.resetRequestId,
      })
      .from(platformBackups)
      .where(eq(platformBackups.id, backupId))
      .limit(1);
    if (!backup) throw new Error('Backup not found');
    if (backup.status === 'deleting') {
      throw new Error('Backup deletion is already in progress');
    }

    if (!isProtected) {
      const [resetRequest] = backup.resetRequestId
        ? await tx
            .select({ status: tenantResetRequests.status })
            .from(tenantResetRequests)
            .where(eq(tenantResetRequests.id, backup.resetRequestId))
            .limit(1)
        : [];
      const policyBlockReason = recoveryPointReleaseBlockReason({
        action: 'unprotect',
        isProtected: backup.isProtected,
        backupStatus: backup.status,
        source: backup.source,
        expiresAt: backup.expiresAt,
        resetStatus: resetRequest?.status ?? null,
      });
      if (policyBlockReason) throw new Error(policyBlockReason);

      if (
        backup.scope === 'platform_operational' &&
        hasLivePlatformResetExecutionClaim(backup.metadata)
      ) {
        throw new Error(
          'This platform recovery point is locked by an active operational reset and cannot be released yet.',
        );
      }
    }

    const [updated] = await tx
      .update(platformBackups)
      .set({ isProtected, updatedAt: new Date() })
      .where(eq(platformBackups.id, backupId))
      .returning();
    if (!updated) throw new Error('Backup not found');
    return updated;
  });
}

/**
 * Reserve a backup for deletion under the same advisory lock used by platform
 * reset execution claims. Once the transaction commits the backup is no longer
 * `ready`, so a later execution claim cannot select it while durable storage is
 * being removed. If storage deletion fails, fail closed rather than returning
 * the backup to an executable state whose archive presence may be uncertain.
 */
export async function deleteBackupWithPlatformResetFence(backupId: string) {
  const db = getDb();
  const backup = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))`);

    const [current] = await tx
      .select()
      .from(platformBackups)
      .where(eq(platformBackups.id, backupId))
      .limit(1);
    if (!current) throw new Error('Backup not found');
    if (current.status === 'deleting') throw new Error('Backup deletion is already in progress');

    const [resetRequest] = current.resetRequestId
      ? await tx
          .select({ status: tenantResetRequests.status })
          .from(tenantResetRequests)
          .where(eq(tenantResetRequests.id, current.resetRequestId))
          .limit(1)
      : [];
    const policyBlockReason = recoveryPointReleaseBlockReason({
      action: 'delete',
      isProtected: current.isProtected,
      backupStatus: current.status,
      source: current.source,
      expiresAt: current.expiresAt,
      resetStatus: resetRequest?.status ?? null,
    });
    if (policyBlockReason) throw new Error(policyBlockReason);

    if (
      current.scope === 'platform_operational' &&
      hasLivePlatformResetExecutionClaim(current.metadata)
    ) {
      throw new Error(
        'This platform recovery point is locked by an active operational reset and cannot be released yet.',
      );
    }

    const [reserved] = await tx
      .update(platformBackups)
      .set({ status: 'deleting', failureReason: null, updatedAt: new Date() })
      .where(
        and(
          eq(platformBackups.id, backupId),
          eq(platformBackups.status, current.status),
          eq(platformBackups.isProtected, current.isProtected),
        ),
      )
      .returning();
    if (!reserved) {
      throw new Error('Backup changed while deletion was being reserved. Refresh and try again.');
    }
    return reserved;
  });

  try {
    if (backup.storageKey) await deleteFile(backup.storageKey);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(platformBackups)
      .set({
        status: 'failed',
        failureReason: `Backup deletion failed: ${message}`,
        updatedAt: new Date(),
      })
      .where(and(eq(platformBackups.id, backupId), eq(platformBackups.status, 'deleting')));
    throw error;
  }

  const [deleted] = await db
    .update(platformBackups)
    .set({
      status: 'deleted',
      storageKey: null,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(and(eq(platformBackups.id, backupId), eq(platformBackups.status, 'deleting')))
    .returning();
  if (!deleted) {
    throw new Error(
      'Backup deletion state changed after durable storage removal. Review the backup before retrying.',
    );
  }
  return deleted;
}

export type PlatformResetExecutionClaimResult =
  | { ok: true; claimId: string }
  | {
      ok: false;
      status: 404 | 409;
      code: 'not_found' | 'claimed' | 'changed';
      message: string;
    };

/**
 * Reserve the platform operational reset globally, regardless of which valid
 * recovery point was selected. Advisory locking serializes claim acquisition;
 * the durable JSONB claim then spans archive verification and destructive work.
 */
export async function acquirePlatformResetExecutionClaim(input: {
  backupId: string;
  actorUserId: string;
}): Promise<PlatformResetExecutionClaimResult> {
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${PLATFORM_RESET_CLAIM_LOCK}))`);

    const [target] = await tx
      .select({ id: platformBackups.id })
      .from(platformBackups)
      .where(
        and(
          eq(platformBackups.id, input.backupId),
          eq(platformBackups.scope, 'platform_operational'),
          eq(platformBackups.status, 'ready'),
          eq(platformBackups.isProtected, true),
        ),
      )
      .limit(1);
    if (!target) {
      return {
        ok: false as const,
        status: 404 as const,
        code: 'not_found' as const,
        message: 'Verified protected platform recovery point not found',
      };
    }

    const now = new Date();
    const staleBefore = new Date(
      now.getTime() - PLATFORM_RESET_EXECUTION_CLAIM_TTL_MINUTES * 60 * 1000,
    );
    const [active] = await tx
      .select({ id: platformBackups.id })
      .from(platformBackups)
      .where(
        and(
          eq(platformBackups.scope, 'platform_operational'),
          sql`${platformBackups.metadata}->>'platformExecutionClaimId' IS NOT NULL`,
          sql`NULLIF(${platformBackups.metadata}->>'platformExecutionClaimedAt', '')::timestamptz >= ${staleBefore}`,
        ),
      )
      .limit(1);
    if (active) {
      return {
        ok: false as const,
        status: 409 as const,
        code: 'claimed' as const,
        message:
          'Another platform operational reset is already in progress. Refresh the platform reset status before trying again.',
      };
    }

    const claimId = randomUUID();
    const [claimed] = await tx
      .update(platformBackups)
      .set({
        metadata: sql`COALESCE(${platformBackups.metadata}, '{}'::jsonb) || jsonb_build_object(
          'platformExecutionClaimId', ${claimId},
          'platformExecutionClaimedAt', ${now.toISOString()},
          'platformExecutionClaimedByUserId', ${input.actorUserId}
        )`,
        updatedAt: now,
      })
      .where(
        and(
          eq(platformBackups.id, input.backupId),
          eq(platformBackups.scope, 'platform_operational'),
          eq(platformBackups.status, 'ready'),
          eq(platformBackups.isProtected, true),
          or(
            sql`${platformBackups.metadata}->>'platformExecutionClaimId' IS NULL`,
            sql`${platformBackups.metadata}->>'platformExecutionClaimId' = ''`,
            sql`NULLIF(${platformBackups.metadata}->>'platformExecutionClaimedAt', '')::timestamptz < ${staleBefore}`,
          )!,
        ),
      )
      .returning({ id: platformBackups.id });

    if (!claimed) {
      return {
        ok: false as const,
        status: 409 as const,
        code: 'changed' as const,
        message:
          'The selected platform recovery point changed while execution was being claimed. Refresh and try again.',
      };
    }

    return { ok: true as const, claimId };
  });
}

export async function releasePlatformResetExecutionClaim(input: {
  backupId: string;
  claimId: string;
}) {
  const db = getDb();
  await db
    .update(platformBackups)
    .set({
      metadata: sql`COALESCE(${platformBackups.metadata}, '{}'::jsonb)
        - 'platformExecutionClaimId'
        - 'platformExecutionClaimedAt'
        - 'platformExecutionClaimedByUserId'`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(platformBackups.id, input.backupId),
        sql`${platformBackups.metadata}->>'platformExecutionClaimId' = ${input.claimId}`,
      ),
    );
}
