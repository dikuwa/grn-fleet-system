import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';

const DEFAULT_APPROVAL_TTL_HOURS = 72;
const DEFAULT_CLAIM_TTL_MINUTES = 15;
const DEFAULT_RECOVERY_CLAIM_TTL_MINUTES = 10;
const MIN_RECOVERY_CLAIM_TTL_MINUTES = 6;

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const RESET_APPROVAL_TTL_HOURS = positiveNumber(
  process.env.RESET_APPROVAL_TTL_HOURS,
  DEFAULT_APPROVAL_TTL_HOURS,
);

export const RESET_EXECUTION_CLAIM_TTL_MINUTES = positiveNumber(
  process.env.RESET_EXECUTION_CLAIM_TTL_MINUTES,
  DEFAULT_CLAIM_TTL_MINUTES,
);

export const RESET_RECOVERY_CLAIM_TTL_MINUTES = Math.max(
  MIN_RECOVERY_CLAIM_TTL_MINUTES,
  positiveNumber(
    process.env.RESET_RECOVERY_CLAIM_TTL_MINUTES,
    DEFAULT_RECOVERY_CLAIM_TTL_MINUTES,
  ),
);

export function resetApprovalExpiresAt(reviewedAt: Date | null) {
  if (!reviewedAt) return null;
  return new Date(reviewedAt.getTime() + RESET_APPROVAL_TTL_HOURS * 60 * 60 * 1000);
}

export function isResetApprovalExpired(reviewedAt: Date | null, now = new Date()) {
  const expiresAt = resetApprovalExpiresAt(reviewedAt);
  return Boolean(expiresAt && expiresAt <= now);
}

export function isResetRequestBlocking(
  request: { status: string; reviewedAt: Date | null },
  now = new Date(),
) {
  if (request.status === 'approved') {
    return !isResetApprovalExpired(request.reviewedAt, now);
  }
  return ['draft', 'pending_review', 'in_progress'].includes(request.status);
}

function metadataClaimIsLive(
  metadata: Record<string, unknown>,
  idKey: string,
  claimedAtKey: string,
  ttlMinutes: number,
  now = new Date(),
) {
  const claimId = typeof metadata[idKey] === 'string' ? metadata[idKey] : '';
  const claimedAtValue =
    typeof metadata[claimedAtKey] === 'string' ? metadata[claimedAtKey] : '';
  if (!claimId || !claimedAtValue) return false;
  const claimedAt = new Date(claimedAtValue);
  if (Number.isNaN(claimedAt.getTime())) return false;
  return claimedAt.getTime() > now.getTime() - ttlMinutes * 60 * 1000;
}

export type ResetExecutionClaimResult =
  | { ok: true; claimId: string; approvalExpiresAt: string | null }
  | {
      ok: false;
      status: 404 | 409;
      code:
        | 'not_found'
        | 'completed'
        | 'in_progress'
        | 'not_approved'
        | 'approval_expired'
        | 'claimed'
        | 'recovery_in_progress';
      message: string;
      data?: Record<string, unknown>;
    };

/**
 * Atomically reserves an approved reset for one execution request.
 *
 * The destructive reset service intentionally keeps its existing `approved →
 * in_progress` transition. This lightweight compare-and-set claim closes the
 * HTTP double-click/concurrent-request window before that transition without
 * introducing another database status or migration. Stale claims may be
 * reclaimed after a short TTL so an interrupted request cannot lock a reset
 * forever.
 */
export async function acquireResetExecutionClaim(input: {
  resetRequestId: string;
  tenantId?: string;
  actorUserId: string;
}): Promise<ResetExecutionClaimResult> {
  const db = getDb();
  const conditions = [eq(tenantResetRequests.id, input.resetRequestId)];
  if (input.tenantId) conditions.push(eq(tenantResetRequests.tenantId, input.tenantId));

  const [current] = await db
    .select({
      id: tenantResetRequests.id,
      status: tenantResetRequests.status,
      reviewedAt: tenantResetRequests.reviewedAt,
      results: tenantResetRequests.results,
      metadata: tenantResetRequests.metadata,
      completedAt: tenantResetRequests.completedAt,
    })
    .from(tenantResetRequests)
    .where(and(...conditions))
    .limit(1);

  if (!current) {
    return { ok: false, status: 404, code: 'not_found', message: 'Reset request not found.' };
  }
  if (current.status === 'completed') {
    return {
      ok: false,
      status: 409,
      code: 'completed',
      message: 'This reset has already completed and will not be executed again.',
      data: { completedAt: current.completedAt?.toISOString() ?? null, results: current.results },
    };
  }
  if (current.status === 'in_progress') {
    return {
      ok: false,
      status: 409,
      code: 'in_progress',
      message: 'This reset is already in progress.',
    };
  }
  if (current.status !== 'approved') {
    return {
      ok: false,
      status: 409,
      code: 'not_approved',
      message: `This reset cannot execute while its status is ${current.status.replaceAll('_', ' ')}.`,
    };
  }

  const approvalExpiresAt = resetApprovalExpiresAt(current.reviewedAt);
  if (isResetApprovalExpired(current.reviewedAt)) {
    return {
      ok: false,
      status: 409,
      code: 'approval_expired',
      message: `Reset approval expired after ${RESET_APPROVAL_TTL_HOURS} hours. Platform Administration must review and approve a fresh impact plan.`,
      data: { approvalExpiresAt: approvalExpiresAt?.toISOString() ?? null },
    };
  }

  const metadata = (current.metadata ?? {}) as Record<string, unknown>;
  if (
    metadataClaimIsLive(
      metadata,
      'recoveryPointClaimId',
      'recoveryPointClaimedAt',
      RESET_RECOVERY_CLAIM_TTL_MINUTES,
    )
  ) {
    return {
      ok: false,
      status: 409,
      code: 'recovery_in_progress',
      message:
        'Recovery point creation is still in progress for this reset. Wait for verification to finish before executing.',
    };
  }

  const claimId = randomUUID();
  const now = new Date();
  const staleBefore = new Date(now.getTime() - RESET_EXECUTION_CLAIM_TTL_MINUTES * 60 * 1000);
  const nextMetadata = {
    ...metadata,
    executionClaimId: claimId,
    executionClaimedAt: now.toISOString(),
    executionClaimedByUserId: input.actorUserId,
    approvalExpiresAt: approvalExpiresAt?.toISOString() ?? null,
    approvalTtlHours: RESET_APPROVAL_TTL_HOURS,
  };

  const claimConditions = [
    ...conditions,
    eq(tenantResetRequests.status, 'approved' as const),
    or(
      sql`${tenantResetRequests.metadata}->>'executionClaimId' IS NULL`,
      sql`${tenantResetRequests.metadata}->>'executionClaimId' = ''`,
      sql`NULLIF(${tenantResetRequests.metadata}->>'executionClaimedAt', '')::timestamptz < ${staleBefore}`,
    )!,
    or(
      sql`${tenantResetRequests.metadata}->>'recoveryPointClaimId' IS NULL`,
      sql`${tenantResetRequests.metadata}->>'recoveryPointClaimId' = ''`,
      sql`NULLIF(${tenantResetRequests.metadata}->>'recoveryPointClaimedAt', '')::timestamptz < ${new Date(now.getTime() - RESET_RECOVERY_CLAIM_TTL_MINUTES * 60 * 1000)}`,
    )!,
  ];
  const [claimed] = await db
    .update(tenantResetRequests)
    .set({ metadata: nextMetadata, updatedAt: now })
    .where(and(...claimConditions))
    .returning({ id: tenantResetRequests.id });

  if (!claimed) {
    return {
      ok: false,
      status: 409,
      code: 'claimed',
      message:
        'Another reset execution or recovery-point request already holds the reset claim. Refresh the reset status before trying again.',
    };
  }

  return { ok: true, claimId, approvalExpiresAt: approvalExpiresAt?.toISOString() ?? null };
}

/** Release a claim only while the reset is still approved (pre-execution failure). */
export async function releaseResetExecutionClaim(input: {
  resetRequestId: string;
  claimId: string;
}) {
  const db = getDb();
  await db
    .update(tenantResetRequests)
    .set({
      metadata: sql`${tenantResetRequests.metadata} - 'executionClaimId' - 'executionClaimedAt' - 'executionClaimedByUserId'`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tenantResetRequests.id, input.resetRequestId),
        eq(tenantResetRequests.status, 'approved' as const),
        sql`${tenantResetRequests.metadata}->>'executionClaimId' = ${input.claimId}`,
      ),
    );
}

export type ResetRecoveryPointClaimResult =
  | { ok: true; claimId: string; claimedAt: Date }
  | {
      ok: false;
      status: 404 | 409;
      code: 'not_found' | 'not_approved' | 'approval_expired' | 'changed' | 'claimed';
      message: string;
    };

/** Reserve the exact approved revision while its recovery point is built and verified. */
export async function acquireResetRecoveryPointClaim(input: {
  resetRequestId: string;
  expectedUpdatedAt: Date;
  actorUserId: string;
}): Promise<ResetRecoveryPointClaimResult> {
  const db = getDb();
  const [current] = await db
    .select({
      id: tenantResetRequests.id,
      status: tenantResetRequests.status,
      reviewedAt: tenantResetRequests.reviewedAt,
      metadata: tenantResetRequests.metadata,
      updatedAt: tenantResetRequests.updatedAt,
    })
    .from(tenantResetRequests)
    .where(eq(tenantResetRequests.id, input.resetRequestId))
    .limit(1);

  if (!current) {
    return { ok: false, status: 404, code: 'not_found', message: 'Reset request not found.' };
  }
  if (current.status !== 'approved') {
    return {
      ok: false,
      status: 409,
      code: 'not_approved',
      message: 'The reset is no longer approved for recovery-point creation.',
    };
  }
  if (isResetApprovalExpired(current.reviewedAt)) {
    return {
      ok: false,
      status: 409,
      code: 'approval_expired',
      message: 'This approval expired before recovery-point creation could start.',
    };
  }
  if (current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
    return {
      ok: false,
      status: 409,
      code: 'changed',
      message:
        'This reset request changed while the recovery point was being prepared. Refresh and create a recovery point from the current revision.',
    };
  }

  const metadata = (current.metadata ?? {}) as Record<string, unknown>;
  const now = new Date();
  const executionStaleBefore = new Date(
    now.getTime() - RESET_EXECUTION_CLAIM_TTL_MINUTES * 60 * 1000,
  );
  const recoveryStaleBefore = new Date(
    now.getTime() - RESET_RECOVERY_CLAIM_TTL_MINUTES * 60 * 1000,
  );
  const claimId = randomUUID();
  const nextMetadata = {
    ...metadata,
    recoveryPointClaimId: claimId,
    recoveryPointClaimedAt: now.toISOString(),
    recoveryPointClaimedByUserId: input.actorUserId,
  };

  const [claimed] = await db
    .update(tenantResetRequests)
    .set({ metadata: nextMetadata, updatedAt: now })
    .where(
      and(
        eq(tenantResetRequests.id, input.resetRequestId),
        eq(tenantResetRequests.status, 'approved' as const),
        eq(tenantResetRequests.updatedAt, input.expectedUpdatedAt),
        or(
          sql`${tenantResetRequests.metadata}->>'executionClaimId' IS NULL`,
          sql`${tenantResetRequests.metadata}->>'executionClaimId' = ''`,
          sql`NULLIF(${tenantResetRequests.metadata}->>'executionClaimedAt', '')::timestamptz < ${executionStaleBefore}`,
        )!,
        or(
          sql`${tenantResetRequests.metadata}->>'recoveryPointClaimId' IS NULL`,
          sql`${tenantResetRequests.metadata}->>'recoveryPointClaimId' = ''`,
          sql`NULLIF(${tenantResetRequests.metadata}->>'recoveryPointClaimedAt', '')::timestamptz < ${recoveryStaleBefore}`,
        )!,
      ),
    )
    .returning({ id: tenantResetRequests.id });

  if (!claimed) {
    return {
      ok: false,
      status: 409,
      code: 'claimed',
      message:
        'Another reset execution or recovery-point request changed this reset. Refresh before trying again.',
    };
  }

  return { ok: true, claimId, claimedAt: now };
}

export async function releaseResetRecoveryPointClaim(input: {
  resetRequestId: string;
  claimId: string;
}) {
  const db = getDb();
  await db
    .update(tenantResetRequests)
    .set({
      metadata: sql`${tenantResetRequests.metadata} - 'recoveryPointClaimId' - 'recoveryPointClaimedAt' - 'recoveryPointClaimedByUserId'`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tenantResetRequests.id, input.resetRequestId),
        eq(tenantResetRequests.status, 'approved' as const),
        sql`${tenantResetRequests.metadata}->>'recoveryPointClaimId' = ${input.claimId}`,
      ),
    );
}
