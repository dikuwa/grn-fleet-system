import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackups } from '@/db/schema';

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
 * claim acquisition. The shared advisory lock makes "no live claim" and the
 * protection update one atomic decision for platform recovery points.
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
      })
      .from(platformBackups)
      .where(eq(platformBackups.id, backupId))
      .limit(1);
    if (!backup) throw new Error('Backup not found');

    if (
      !isProtected &&
      backup.scope === 'platform_operational' &&
      hasLivePlatformResetExecutionClaim(backup.metadata)
    ) {
      throw new Error(
        'This platform recovery point is locked by an active operational reset and cannot be released yet.',
      );
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
