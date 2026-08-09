/**
 * Offline Draft Store (PWA)
 *
 * Uses Dexie (IndexedDB wrapper) to persist form drafts locally. Drafts are
 * scoped to the authenticated user and tenant when read for display or sync;
 * ownerless legacy drafts are intentionally not auto-adopted by another account
 * on a shared device.
 */
import Dexie, { type EntityTable } from 'dexie';

export interface OfflineDraft {
  id: string;
  draftType:
    | 'fuel'
    | 'request'
    | 'trip_log'
    | 'trip_progress'
    | 'trip_incident'
    | 'trip_expense'
    | 'inspection_departure'
    | 'inspection_return';
  formData: Record<string, unknown>;
  userId: string | null;
  tenantId: string | null;
  updatedAt: string;
  createdAt: string;
  syncStatus: 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
  syncError?: string | null;
  syncedEntityId?: string | null;
}

const db = new Dexie('GovFleetOfflineDrafts') as Dexie & {
  drafts: EntityTable<OfflineDraft, 'id'>;
};

db.version(1).stores({
  drafts: '++id, draftType, userId, syncStatus, updatedAt, createdAt, tenantId',
});

export async function saveDraft(
  draft: Omit<OfflineDraft, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
) {
  const now = new Date().toISOString();
  const existing = draft.id ? await db.drafts.get(draft.id) : undefined;
  const record: OfflineDraft = {
    ...draft,
    id: draft.id || crypto.randomUUID(),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await db.drafts.put(record);
  return record;
}

export async function updateDraft(
  id: string,
  patch: Partial<Omit<OfflineDraft, 'id' | 'createdAt'>>,
) {
  const existing = await db.drafts.get(id);
  if (!existing) throw new Error(`OfflineDraft not found: ${id}`);
  const updated: OfflineDraft = {
    ...existing,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await db.drafts.put(updated);
  return updated;
}

export async function getDraft(id: string): Promise<OfflineDraft | undefined> {
  return db.drafts.get(id);
}

export async function listDrafts(filters?: {
  draftType?: OfflineDraft['draftType'];
  draftTypes?: OfflineDraft['draftType'][];
  syncStatus?: OfflineDraft['syncStatus'];
  syncStatuses?: OfflineDraft['syncStatus'][];
  userId?: string;
  tenantId?: string;
}): Promise<OfflineDraft[]> {
  let collection = db.drafts.orderBy('updatedAt').reverse();
  if (filters?.draftType) {
    collection = collection.filter((draft) => draft.draftType === filters.draftType) as typeof collection;
  }
  if (filters?.draftTypes) {
    const allowed = new Set(filters.draftTypes);
    collection = collection.filter((draft) => allowed.has(draft.draftType)) as typeof collection;
  }
  if (filters?.syncStatus) {
    collection = collection.filter((draft) => draft.syncStatus === filters.syncStatus) as typeof collection;
  }
  if (filters?.syncStatuses) {
    const allowed = new Set(filters.syncStatuses);
    collection = collection.filter((draft) => allowed.has(draft.syncStatus)) as typeof collection;
  }
  if (filters?.userId) {
    collection = collection.filter((draft) => draft.userId === filters.userId) as typeof collection;
  }
  if (filters?.tenantId) {
    collection = collection.filter((draft) => draft.tenantId === filters.tenantId) as typeof collection;
  }
  return collection.toArray();
}

export async function deleteDraft(id: string): Promise<void> {
  await db.drafts.delete(id);
}

export async function countUnsyncedDrafts(filters?: { userId?: string; tenantId?: string }): Promise<number> {
  return db.drafts
    .filter(
      (draft) =>
        (draft.syncStatus === 'pending' || draft.syncStatus === 'failed') &&
        (!filters?.userId || draft.userId === filters.userId) &&
        (!filters?.tenantId || draft.tenantId === filters.tenantId),
    )
    .count();
}

export async function markDraftSynced(id: string, syncedEntityId: string | null) {
  return updateDraft(id, { syncStatus: 'synced', syncedEntityId, syncError: null });
}

export async function markDraftFailed(id: string, error: string) {
  return updateDraft(id, { syncStatus: 'failed', syncError: error });
}

export async function markDraftConflict(id: string, error: string) {
  return updateDraft(id, { syncStatus: 'conflict', syncError: error });
}

export async function removeSyncedDrafts(filters?: { userId?: string; tenantId?: string }) {
  // Never perform a cross-account cleanup on a shared device. Legacy callers
  // without a complete identity scope simply leave synced drafts visible until
  // a scoped cleanup call or explicit user discard.
  if (!filters?.userId || !filters?.tenantId) return;
  const synced = await db.drafts
    .filter(
      (draft) =>
        draft.syncStatus === 'synced' &&
        draft.userId === filters.userId &&
        draft.tenantId === filters.tenantId,
    )
    .toArray();
  await Promise.all(synced.map((draft) => db.drafts.delete(draft.id)));
}

export { db };
