/**
 * Offline Draft Sync Engine
 *
 * When the browser comes back online, this engine automatically submits
 * pending offline drafts to their respective API endpoints.
 *
 * Usage: call `triggerSync()` after a successful online event, or use
 * the `useOfflineSync` hook in a component that stays mounted.
 */

import { listDrafts, markDraftSynced, markDraftFailed, removeSyncedDrafts } from '@/lib/offline-drafts';
import type { OfflineDraft } from '@/lib/offline-drafts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Type-safe accessor for formData fields */
function fd<T = string>(data: Record<string, unknown>, key: string, fallback: T): T {
  const val = data[key];
  return (val !== undefined && val !== null ? val : fallback) as unknown as T;
}

// ---------------------------------------------------------------------------
// Draft-to-API mapper
// ---------------------------------------------------------------------------

interface SyncEndpoint {
  url: string;
  method: 'POST' | 'PUT';
  /** Transform the stored formData into the API payload */
  transform: (draft: OfflineDraft) => Record<string, unknown>;
}

function getEndpoint(draft: OfflineDraft): SyncEndpoint | null {
  switch (draft.draftType) {
    case 'fuel':
      return {
        url: '/api/fuel',
        method: 'POST',
        transform: (d) => ({
          vehicleGrn: fd(d.formData, 'vehicleGrn', ''),
          tripId: fd<string | null>(d.formData, 'tripRef', null),
          transactionAt: fd(d.formData, 'transactionDate', new Date().toISOString()),
          stationName: fd(d.formData, 'stationName', ''),
          fuelType: fd(d.formData, 'fuelType', 'diesel'),
          litres: fd(d.formData, 'litres', '0'),
          amount: fd(d.formData, 'amount', '0'),
          odometerReading: fd<number | null>(d.formData, 'odometerReading', null),
          paymentMethod: fd(d.formData, 'paymentMethod', 'fuel_card'),
          fillType: fd(d.formData, 'fillType', 'full'),
          recordedByUserId: d.userId || 'system',
          employeeNumber: '',
          tenantId: d.tenantId || '00000000-0000-0000-0000-000000000001',
        }),
      };

    case 'request':
      // NOTE: /api/transport-requests POST endpoint does not exist yet.
      // When it's created, this mapper will submit the draft.
      return null;

    case 'inspection_departure':
    case 'inspection_return':
      // NOTE: /api/inspections/departure and /api/inspections/return
      // POST endpoints do not exist yet. When they're created, this
      // mapper will submit the draft.
      return null;

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

type SyncResult = {
  synced: number;
  failed: number;
  errors: Array<{ id: string; draftType: string; error: string }>;
};

/**
 * Attempt to sync all pending drafts.
 * Returns counts of synced/failed drafts.
 */
export async function syncPendingDrafts(): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, errors: [] };

  const pending = await listDrafts({ syncStatus: 'pending' });
  const failed = await listDrafts({ syncStatus: 'failed' });
  const toSync = [...pending, ...failed];

  if (toSync.length === 0) return result;

  for (const draft of toSync) {
    const endpoint = getEndpoint(draft);
    if (!endpoint) {
      await markDraftFailed(draft.id, 'Unknown draft type');
      result.failed++;
      continue;
    }

    try {
      const payload = endpoint.transform(draft);
      const res = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        await markDraftFailed(draft.id, err.error || `HTTP ${res.status}`);
        result.failed++;
        result.errors.push({ id: draft.id, draftType: draft.draftType, error: err.error || `HTTP ${res.status}` });
        continue;
      }

      const responseData = await res.json();
      const entityId = responseData?.data?.id || responseData?.id || null;
      await markDraftSynced(draft.id, entityId);
      result.synced++;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Network error';
      await markDraftFailed(draft.id, message);
      result.failed++;
      result.errors.push({ id: draft.id, draftType: draft.draftType, error: message });
    }
  }

  // Clean up successfully synced drafts
  if (result.synced > 0) {
    await removeSyncedDrafts();
  }

  return result;
}


