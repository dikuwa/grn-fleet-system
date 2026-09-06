import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { platformBackups } from '@/db/schema';

const DEFAULT_PLATFORM_RESET_CLAIM_TTL_MINUTES = 10;
const MIN_PLATFORM_RESET_CLAIM_TTL_MINUTES = 6;

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
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('govfleet-platform-operational-reset-claim'))`,
    );

    const [target] = await tx
      .select({ id: platformBackups.id })
      .from(platformBackups)
      .where(
        and(
          eq(platformBackups.id, input.backupId),
          eq(platformBackups.scope, 'platform_operational'),
          eq(platformBackups.status, 'ready'),
        ),
      )
      .limit(1);
    if (!target) {
      return {
        ok: false as const,
        status: 404 as const,
        code: 'not_found' as const,
        message: 'Verified platform recovery point not found',
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
          eq(platformBackups.status, 'ready'),
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
