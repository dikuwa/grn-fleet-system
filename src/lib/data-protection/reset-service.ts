import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantResetRequests } from '@/db/schema/reset-requests';
import { recordAuditEvent } from '@/lib/audit-event';
import type { ResetDb } from '@/lib/data-reset/plan';
import {
  executeApprovedTenantOperationalReset as executeApprovedTenantOperationalResetCore,
  previewTenantOperationalReset,
  resetPlanFingerprint,
  type ResetPreview,
} from './reset-service-core';
import {
  collectAdvancedResetStorageKeys,
  removeApprovedResetStorageFiles,
} from './reset-storage-cleanup';

export { previewTenantOperationalReset, resetPlanFingerprint };
export type { ResetPreview };

/**
 * Governed reset wrapper that preserves the validated atomic database executor
 * and adds post-commit cleanup for storage objects owned by rows in the exact
 * approved reset plan.
 */
export async function executeApprovedTenantOperationalReset(
  input: Parameters<typeof executeApprovedTenantOperationalResetCore>[0],
) {
  const db = getDb();
  const [request] = await db
    .select({
      tenantId: tenantResetRequests.tenantId,
      status: tenantResetRequests.status,
      metadata: tenantResetRequests.metadata,
    })
    .from(tenantResetRequests)
    .where(eq(tenantResetRequests.id, input.resetRequestId))
    .limit(1);

  // Preserve the core executor's authorization/not-found behavior before doing
  // any reset-plan discovery for a caller scoped to a different tenant.
  if (!request || (input.actorTenantId && request.tenantId !== input.actorTenantId)) {
    return executeApprovedTenantOperationalResetCore(input);
  }

  // Non-approved requests fail in the core executor without paying the cost of
  // a preview or reading reset-owned storage metadata.
  if (request.status !== 'approved') {
    return executeApprovedTenantOperationalResetCore(input);
  }

  const resetSpec = (request.metadata as { resetSpec?: unknown } | null)?.resetSpec;
  const { plan, advancedPlan } = await previewTenantOperationalReset(request.tenantId, resetSpec);
  const advancedStorageKeys = await collectAdvancedResetStorageKeys(
    db as unknown as ResetDb,
    advancedPlan,
  );
  const storageKeys = [
    ...new Set([
      ...(advancedPlan.resetSpec.categories.includes('operations') ? plan.fileKeys : []),
      ...advancedStorageKeys,
    ]),
  ];

  const result = await executeApprovedTenantOperationalResetCore(input);
  const databaseMutationSucceeded = result.outcomes.every((outcome) => !outcome.error);
  const storage = databaseMutationSucceeded
    ? await removeApprovedResetStorageFiles(storageKeys)
    : { removed: [] as string[], preserved: storageKeys };

  // The core executor has already committed the governed reset result at this
  // point. Storage-report persistence must not turn a completed reset into an
  // HTTP failure, so metadata/audit recording is best-effort and observable.
  try {
    const [current] = await db
      .select({ results: tenantResetRequests.results })
      .from(tenantResetRequests)
      .where(eq(tenantResetRequests.id, input.resetRequestId))
      .limit(1);
    const currentResults = (current?.results ?? {}) as Record<string, unknown>;
    await db
      .update(tenantResetRequests)
      .set({
        results: {
          ...currentResults,
          storageFilesRemoved: storage.removed,
          storageFilesPreserved: storage.preserved.length,
        },
        updatedAt: new Date(),
      })
      .where(eq(tenantResetRequests.id, input.resetRequestId));

    await recordAuditEvent({
      tenantId: request.tenantId,
      actorUserId: input.actorUserId,
      action: 'reset_request.storage_cleanup_completed',
      entityType: 'reset_request',
      entityId: input.resetRequestId,
      summary: `Reset storage cleanup removed ${storage.removed.length} object(s); ${storage.preserved.length} object(s) were preserved for follow-up.`,
      after: {
        databaseMutationSucceeded,
        storageFilesPlanned: storageKeys.length,
        storageFilesRemoved: storage.removed.length,
        storageFilesPreserved: storage.preserved.length,
      },
    });
  } catch (error) {
    console.error('[Tenant Reset] Could not persist storage cleanup outcome:', error);
  }

  return {
    ...result,
    storageFilesRemoved: storage.removed,
    storageFilesPreserved: storage.preserved.length,
  };
}
