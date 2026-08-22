const LATE_INCIDENT_STATUSES = new Set(['return_inspection', 'closure_review', 'closed']);

export type OfflineIncidentWindowInput = {
  tripStatus: string;
  startedAt: Date | null;
  returnedAt: Date | null;
  closedAt: Date | null;
  occurredAt: Date;
  offlineCreatedAt: Date | null;
  clientSyncId: string | null;
};

/**
 * Decide whether an incident captured offline during an active journey may be
 * accepted after the server-side trip has already advanced into return or
 * closure.
 *
 * This is intentionally narrow: the request must be an idempotent offline
 * replay, both the incident occurrence and the local draft timestamp must fall
 * inside the actual journey window, and only normal return/closure states are
 * eligible. A cancelled trip or a draft created after return can never use this
 * exception.
 */
export function canAcceptLateOfflineIncident(input: OfflineIncidentWindowInput): boolean {
  if (!input.clientSyncId || !input.offlineCreatedAt || !input.startedAt) return false;
  if (!LATE_INCIDENT_STATUSES.has(input.tripStatus)) return false;

  const journeyEnd = input.returnedAt ?? input.closedAt;
  if (!journeyEnd) return false;

  const start = input.startedAt.getTime();
  const end = journeyEnd.getTime();
  const occurred = input.occurredAt.getTime();
  const drafted = input.offlineCreatedAt.getTime();

  if (![start, end, occurred, drafted].every(Number.isFinite)) return false;
  if (end < start) return false;

  return occurred >= start && occurred <= end && drafted >= start && drafted <= end;
}
