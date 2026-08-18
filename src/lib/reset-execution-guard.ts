import { randomUUID } from 'node:crypto';
import { and, eq, or, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';

const DEFAULT_APPROVAL_TTL_HOURS = 72;
const DEFAULT_CLAIM_TTL_MINUTES = 15;

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

export function resetApprovalExpiresAt(reviewedAt: Date | null) {
  if (!reviewedAt) return null;
  return new Date(reviewedAt.getTime() + RESET_APPROVAL_TTL_HOURS * 60 * 60 * 1000);
}

export function isResetApprovalExpired(reviewedAt: Date | null, now = new Date()) {
  const expiresAt = resetApprovalExpiresAt(reviewedAt);
  return Boolean(expiresAt && expiresAt <= now);
}

export type ResetExecutionClaimResult =
  | { ok: true; claimId: string; approvalExpiresAt: string | null }
  | {
      ok: false;
      status: 404 | 409;
      code: 'not_found' | 'completed' | 'in_progress' | 'not_approved' | 'approval_expired' | 'claimed';
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
      message: 'Another reset execution request already holds the execution claim. Refresh the reset status before trying again.',
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
  const [current] = await db
    .select({ metadata: tenantResetRequests.metadata })
    .from(tenantResetRequests)
    .where(
      and(
        eq(tenantResetRequests.id, input.resetRequestId),
        eq(tenantResetRequests.status, 'approved' as const),
        sql`${tenantResetRequests.metadata}->>'executionClaimId' = ${input.claimId}`,
      ),
    )
    .limit(1);
  if (!current) return;
  const metadata = { ...((current.metadata ?? {}) as Record<string, unknown>) };
  delete metadata.executionClaimId;
  delete metadata.executionClaimedAt;
  delete metadata.executionClaimedByUserId;
  await db
    .update(tenantResetRequests)
    .set({ metadata, updatedAt: new Date() })
    .where(
      and(
        eq(tenantResetRequests.id, input.resetRequestId),
        eq(tenantResetRequests.status, 'approved' as const),
        sql`${tenantResetRequests.metadata}->>'executionClaimId' = ${input.claimId}`,
      ),
    );
}
