export interface ResetPreviewData {
  dryRunSummary: {
    requests: number;
    trips: number;
    documents: number;
    notifications: number;
    total: number;
  };
  steps: Array<{ table: string; label: string; planned: number }>;
  preserved: Array<{ table: string; label: string; count: number }>;
  review: Array<{ table: string; label: string; reason: string; count: number }>;
  fingerprint: string;
  plannedAt: string;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * JSONB reset columns default to `{}` before the first dry run. Never treat
 * that placeholder as a usable impact preview.
 */
export function normalizeResetPreview(value: unknown): ResetPreviewData | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const summary = candidate.dryRunSummary;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  const totals = summary as Record<string, unknown>;
  const requests = finiteNumber(totals.requests);
  const trips = finiteNumber(totals.trips);
  const documents = finiteNumber(totals.documents);
  const notifications = finiteNumber(totals.notifications);
  const total = finiteNumber(totals.total);
  if ([requests, trips, documents, notifications, total].some((entry) => entry === null)) return null;
  if (typeof candidate.fingerprint !== 'string' || !candidate.fingerprint) return null;

  return {
    dryRunSummary: {
      requests: requests!,
      trips: trips!,
      documents: documents!,
      notifications: notifications!,
      total: total!,
    },
    steps: Array.isArray(candidate.steps) ? candidate.steps as ResetPreviewData['steps'] : [],
    preserved: Array.isArray(candidate.preserved) ? candidate.preserved as ResetPreviewData['preserved'] : [],
    review: Array.isArray(candidate.review) ? candidate.review as ResetPreviewData['review'] : [],
    fingerprint: candidate.fingerprint,
    plannedAt: typeof candidate.plannedAt === 'string' ? candidate.plannedAt : '',
  };
}
