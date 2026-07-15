/**
 * Offline Draft Store (PWA)
 *
 * Uses Dexie (IndexedDB wrapper) to persist form drafts locally so
 * field officers can record fuel entries, transport requests, and
 * inspections without a network connection. Drafts sync automatically
 * when connectivity resumes.
 *
 * Feature flag: NEXT_PUBLIC_ENABLE_OFFLINE_DRAFTS
 */

import Dexie, { type EntityTable } from 'dexie';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OfflineDraft {
  id: string;
  draftType: 'fuel' | 'request' | 'inspection_departure' | 'inspection_return';
  /** Serialised form state */
  formData: Record<string, unknown>;
  /** The user who drafted this (from auth session) */
  userId: string | null;
  /** Tenant context */
  tenantId: string | null;
  /** Local timestamp of last modification */
  updatedAt: string; // ISO-8601
  /** Local timestamp of creation */
  createdAt: string; // ISO-8601
  /** Sync status */
  syncStatus: 'pending' | 'syncing' | 'synced' | 'conflict' | 'failed';
  /** Error message from last sync attempt */
  syncError?: string | null;
  /** Server entity ID after successful sync */
  syncedEntityId?: string | null;
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

const db = new Dexie('GovFleetOfflineDrafts') as Dexie & {
  drafts: EntityTable<OfflineDraft, 'id'>;
};

db.version(1).stores({
  drafts:
    '++id, draftType, userId, syncStatus, updatedAt, createdAt, tenantId',
});

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

export async function saveDraft(draft: Omit<OfflineDraft, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }) {
  const now = new Date().toISOString();
  const record: OfflineDraft = {
    ...draft,
    id: draft.id || crypto.randomUUID(),
    createdAt: now,
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

export async function listDrafts(
  filters?: { draftType?: OfflineDraft['draftType']; syncStatus?: OfflineDraft['syncStatus'] },
): Promise<OfflineDraft[]> {
  let collection = db.drafts.orderBy('updatedAt').reverse();

  if (filters?.draftType) {
    collection = collection.filter((d) => d.draftType === filters.draftType) as typeof collection;
  }
  if (filters?.syncStatus) {
    collection = collection.filter((d) => d.syncStatus === filters.syncStatus) as typeof collection;
  }

  return collection.toArray();
}

export async function deleteDraft(id: string): Promise<void> {
  await db.drafts.delete(id);
}

export async function countUnsyncedDrafts(): Promise<number> {
  return db.drafts
    .filter((d) => d.syncStatus === 'pending' || d.syncStatus === 'failed')
    .count();
}

export async function markDraftSynced(
  id: string,
  syncedEntityId: string,
) {
  return updateDraft(id, {
    syncStatus: 'synced',
    syncedEntityId,
    syncError: null,
  });
}

export async function markDraftFailed(id: string, error: string) {
  return updateDraft(id, {
    syncStatus: 'failed',
    syncError: error,
  });
}

export async function markDraftConflict(id: string, error: string) {
  return updateDraft(id, {
    syncStatus: 'conflict',
    syncError: error,
  });
}

export async function removeSyncedDrafts() {
  const synced = await db.drafts
    .filter((d) => d.syncStatus === 'synced')
    .toArray();

  await Promise.all(synced.map((d) => db.drafts.delete(d.id)));
}

export { db };
