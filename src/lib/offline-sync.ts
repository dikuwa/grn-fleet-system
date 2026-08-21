/**
 * Offline Draft Sync Engine
 *
 * When the browser comes back online, this engine automatically submits
 * pending offline drafts to their respective API endpoints.
 *
 * Usage: call `triggerSync()` after a successful online event, or use
 * the `useOfflineSync` hook in a component that stays mounted.
 */

import {
  listDrafts,
  getDraft,
  markDraftSynced,
  markDraftFailed,
  markDraftConflict,
  removeSyncedDrafts,
  updateDraft,
} from '@/lib/offline-drafts';
import type { OfflineDraft } from '@/lib/offline-drafts';
import { computeSha256 } from '@/lib/storage-dedup';

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
          vehicleId: fd<string | null>(d.formData, 'vehicleId', null),
          vehicleGrn: fd(d.formData, 'vehicleGrn', ''),
          tripId: fd<string | null>(d.formData, 'tripId', null),
          tripRef: fd<string | null>(d.formData, 'tripRef', null),
          driverEmployeeId: fd<string | null>(d.formData, 'driverEmployeeId', null),
          claimantEmployeeId: fd<string | null>(d.formData, 'claimantEmployeeId', null),
          transactionAt: fd(d.formData, 'transactionDate', new Date().toISOString()),
          stationName: fd(d.formData, 'stationName', ''),
          fuelType: fd(d.formData, 'fuelType', 'diesel'),
          litres: fd(d.formData, 'litres', '0'),
          amount: fd(d.formData, 'amount', '0'),
          odometerReading: fd<number | null>(d.formData, 'odometerReading', null),
          referenceNumber: fd<string | null>(d.formData, 'referenceNumber', null),
          paymentMethod: fd(d.formData, 'paymentMethod', 'fuel_card'),
          fillType: fd(d.formData, 'fillType', 'full'),
          notes: fd<string | null>(d.formData, 'notes', null),
          clientSyncId: d.id,
        }),
      };

    case 'request':
      return {
        url: '/api/transport-requests',
        method: 'POST',
        transform: (d) => ({ ...d.formData, clientSubmissionId: d.id }),
      };

    case 'trip_log':
      return {
        url: '/api/trip-logs',
        method: 'POST',
        transform: (d) => ({
          tripId: fd(d.formData, 'tripId', ''),
          logDate: fd(d.formData, 'logDate', new Date().toISOString().slice(0, 10)),
          odometerOut: Number(fd(d.formData, 'odometerOut', '0')) || null,
          odometerIn: Number(fd(d.formData, 'odometerIn', '0')) || null,
          departureTime: fd<string | null>(d.formData, 'departureTime', null),
          arrivalTime: fd<string | null>(d.formData, 'arrivalTime', null),
          origin: fd<string | null>(d.formData, 'origin', null),
          destination: fd<string | null>(d.formData, 'destination', null),
          distanceKm: Number(fd(d.formData, 'distanceKm', '0')) || null,
          remarks: fd<string | null>(d.formData, 'remarks', null),
          clientSyncId: d.id,
        }),
      };

    case 'trip_progress':
    case 'trip_incident':
    case 'trip_expense':
      return {
        url: `/api/trips/${encodeURIComponent(fd(draft.formData, 'tripId', ''))}/operations`,
        method: 'POST',
        transform: (draft) => ({
          ...draft.formData,
          action: draft.draftType === 'trip_progress'
            ? 'progress'
            : draft.draftType === 'trip_incident'
              ? 'incident'
              : 'expense',
          clientSyncId: draft.id,
          offlineCreatedAt: draft.createdAt,
        }),
      };

    case 'inspection_departure':
    case 'inspection_return':
      return {
        url: '/api/inspections',
        method: 'POST',
        transform: (d) => ({
          vehicleId: fd(d.formData, 'vehicleId', ''),
          tripId: fd<string | null>(d.formData, 'tripRef', null),
          type: d.draftType === 'inspection_departure' ? 'departure' : 'return',
          odometerReading: Number(fd(d.formData, 'odometerReading', '0')),
          fuelLevel: fd(d.formData, 'fuelLevel', 'full'),
          checklist: fd<Array<Record<string, unknown>>>(d.formData, 'checklist', []),
          notes: fd<string | null>(d.formData, 'notes', null),
          inspectorAcknowledged: fd(d.formData, 'inspectorAcknowledged', false),
          driverAcknowledged: fd(d.formData, 'driverAcknowledged', false),
          clientSyncId: d.id,
        }),
      };

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
 * Sync a single draft by ID.
 * Returns the sync result for that one draft, or null if not found.
 */
export async function syncSingleDraft(
  draftId: string,
): Promise<{ synced: boolean; error?: string; entityId?: string | null } | null> {
  const draft = await getDraft(draftId);
  if (!draft) return null;

  // Older clients allowed “breakdown” to be saved as ordinary trip progress.
  // A breakdown is safety-significant and must go through the structured
  // incident/defect workflow so vehicle restriction, Transport review and
  // maintenance follow-up cannot be bypassed. Quarantine legacy drafts as a
  // conflict rather than retrying them indefinitely as failed progress writes.
  if (
    draft.draftType === 'trip_progress' &&
    fd(draft.formData, 'entryType', '') === 'breakdown'
  ) {
    const message =
      'This saved breakdown must be re-entered using “Report incident, damage or defect” so the required safety and maintenance workflow is created.';
    await markDraftConflict(draft.id, message);
    return { synced: false, error: message };
  }

  const endpoint = getEndpoint(draft);
  if (!endpoint) {
    await markDraftFailed(draft.id, 'Unknown draft type');
    return { synced: false, error: 'Unknown draft type' };
  }

  try {
    const payload = endpoint.transform(draft);
    if (draft.draftType === 'trip_incident') {
      const files = fd<File[]>(draft.formData, 'attachmentFiles', []);
      const attachmentKeys = fd<string[]>(draft.formData, 'attachmentKeys', []);
      const attachmentHashes = fd<Record<string, string>>(draft.formData, 'attachmentHashes', {});
      for (let index = attachmentKeys.length; index < files.length; index++) {
        const file = files[index];
        const sha256 = await computeSha256(file);

        const dedupRes = await fetch('/api/storage/check-dup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sha256, category: 'trip-incident' }),
        });
        const dedup = dedupRes.ok
          ? await dedupRes.json().catch(() => null)
          : null;
        const existingKey = dedup?.data?.keys?.[0];

        let key: string;
        if (existingKey) {
          key = existingKey;
        } else {
          const uploadBody = new FormData();
          uploadBody.append('file', file);
          uploadBody.append('category', 'trip-incident');
          uploadBody.append('sha256', sha256);
          const upload = await fetch('/api/upload', { method: 'POST', body: uploadBody });
          const uploaded = await upload.json().catch(() => ({}));
          if (!upload.ok || !uploaded.data?.key) throw new Error(uploaded.error || 'Incident attachment upload failed during sync');
          key = uploaded.data.key;
        }

        attachmentKeys.push(key);
        attachmentHashes[key] = sha256;
        await updateDraft(draft.id, {
          formData: {
            ...draft.formData,
            attachmentFiles: files,
            attachmentKeys: [...attachmentKeys],
            attachmentHashes: { ...attachmentHashes },
          },
        });
      }
      payload.attachmentKeys = attachmentKeys;
      payload.attachmentHashes = attachmentHashes;
      delete payload.attachmentFiles;
    }

    if (draft.draftType === 'inspection_departure' || draft.draftType === 'inspection_return') {
      const files = fd<File[]>(draft.formData, 'photos', []);
      const photoKeys = fd<string[]>(draft.formData, 'photoKeys', []);
      for (let index = photoKeys.length; index < files.length; index++) {
        const file = files[index];
        const form = new FormData();
        form.append('file', file);
        form.append('category', 'inspection');
        const upload = await fetch('/api/upload', { method: 'POST', body: form });
        if (!upload.ok) throw new Error('Inspection photo upload failed during sync');
        const uploaded = await upload.json();
        if (!uploaded.data?.key) throw new Error('Inspection photo upload returned no storage key');

        photoKeys.push(uploaded.data.key);
        await updateDraft(draft.id, {
          formData: {
            ...draft.formData,
            photos: files,
            photoKeys: [...photoKeys],
          },
        });
      }
      payload.photoKeys = photoKeys;
    }

    const res = await fetch(endpoint.url, {
      method: endpoint.method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let responseData: Record<string, unknown> | null = null;
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));

      if (draft.draftType === 'fuel' && res.status === 409) {
        const recovery = await fetch(`/api/fuel/sync/${encodeURIComponent(draft.id)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (recovery.ok) {
          responseData = await recovery.json();
        }
      }

      if (
        !responseData &&
        (draft.draftType === 'inspection_departure' || draft.draftType === 'inspection_return')
      ) {
        const recovery = await fetch(`/api/inspections/sync/${encodeURIComponent(draft.id)}`, {
          method: 'GET',
          cache: 'no-store',
        });
        if (recovery.ok) {
          responseData = await recovery.json();
        }
      }

      if (!responseData) {
        const errorMsg = err.error || `HTTP ${res.status}`;
        await markDraftFailed(draft.id, errorMsg);
        return { synced: false, error: errorMsg };
      }
    } else {
      responseData = await res.json();
    }

    const entityId = (responseData as { data?: { id?: string }; id?: string })?.data?.id ||
      (responseData as { id?: string })?.id || null;
    if (draft.draftType === 'fuel') {
      const receiptFile = fd<File | null>(draft.formData, 'receiptFile', null);
      if (receiptFile && entityId) {
        const receiptForm = new FormData();
        receiptForm.append('file', receiptFile);
        receiptForm.append('transactionId', entityId);
        const receiptResponse = await fetch('/api/fuel/receipts', {
          method: 'POST',
          body: receiptForm,
        });
        if (!receiptResponse.ok) {
          const receiptError = await receiptResponse.json().catch(() => ({ error: 'Receipt sync failed' }));
          const duplicateRecovered =
            receiptResponse.status === 409 && typeof receiptError.duplicateReceiptId === 'string';
          if (!duplicateRecovered) {
            throw new Error(receiptError.error || 'Receipt sync failed');
          }
        }
      }
    }
    await markDraftSynced(draft.id, entityId);
    return { synced: true, entityId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Network error';
    await markDraftFailed(draft.id, message);
    return { synced: false, error: message };
  }
}

/**
 * Attempt to sync all pending drafts.
 * Returns counts of synced/failed drafts.
 */
export async function syncPendingDrafts(filters?: {
  userId?: string;
  tenantId?: string;
  draftTypes?: OfflineDraft['draftType'][];
}): Promise<SyncResult> {
  const result: SyncResult = { synced: 0, failed: 0, errors: [] };

  const toSync = await listDrafts({
    syncStatuses: ['pending', 'failed'],
    userId: filters?.userId,
    tenantId: filters?.tenantId,
    draftTypes: filters?.draftTypes,
  });

  if (toSync.length === 0) return result;

  for (const draft of toSync) {
    const singleResult = await syncSingleDraft(draft.id);
    if (!singleResult) {
      await markDraftFailed(draft.id, 'Draft not found');
      result.failed++;
      continue;
    }
    if (singleResult.synced) {
      result.synced++;
    } else {
      result.failed++;
      result.errors.push({
        id: draft.id,
        draftType: draft.draftType,
        error: singleResult.error || 'Unknown error',
      });
    }
  }

  if (result.synced > 0 && filters?.userId && filters?.tenantId) {
    await removeSyncedDrafts({ userId: filters.userId, tenantId: filters.tenantId });
  }

  return result;
}
