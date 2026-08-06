'use client';

import { useEffect, useRef, useState } from 'react';
import { getWorkspaceNavigation, type WorkspaceId } from '@/lib/dashboard-access';

/**
 * Badge query → attention count endpoint.
 *
 * Each navigation item may declare a `badgeQuery` (see dashboard-access.ts).
 * This map tells the hook which endpoint to fetch for a given query. Queries
 * without an entry are never fetched, so the sidebar/mobile nav never call an
 * endpoint they cannot consume.
 */
const BADGE_ENDPOINTS: Record<string, string> = {
  'trips:assigned-attention': '/api/trips/attention',
  'approvals:assigned': '/api/approvals/attention',
  'requests:drafts': '/api/requests/attention',
  'inspections:assigned': '/api/inspections/attention',
  'licences:pending-verification': '/api/drivers/licences/attention',
};

/** How often to re-poll for fresh counts while the tab is visible. */
const POLL_INTERVAL_MS = 30_000;

/**
 * Last-known counts per workspace. Keyed by workspace id so navigating between
 * workspaces (or remounting the shell) restores the previous counts instantly
 * instead of flashing empty badges; a background refresh then revalidates.
 */
const countsCache = new Map<WorkspaceId, Record<string, number>>();

function neededQueries(activeWorkspace: WorkspaceId) {
  // Only fetch queries the workspace's navigation actually declares, and only
  // those we have an endpoint for.
  return Array.from(
    new Set(
      getWorkspaceNavigation(activeWorkspace)
        .map((item) => item.badgeQuery)
        .filter((query): query is string => Boolean(query && BADGE_ENDPOINTS[query])),
    ),
  );
}

/**
 * Live attention counts for the badge queries used by a workspace's
 * navigation.
 *
 * Counts are cached per workspace and re-polled while the tab is visible, so
 * returning to a page shows the last-known value immediately and refreshes in
 * the background. A failed request keeps the previous count rather than
 * dropping the badge.
 *
 * @param activeWorkspace the currently active workspace
 * @returns a record keyed by badgeQuery → live count (0 when unset)
 */
export function useAttentionBadges(activeWorkspace: WorkspaceId) {
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>(
    () => countsCache.get(activeWorkspace) ?? {},
  );

  // Restore the cached counts for the newly-active workspace during render
  // (React's documented "adjusting state when props change" pattern), so a
  // workspace switch repaints instantly with last-known values instead of
  // flashing the previous workspace's badges while the fresh fetch resolves.
  const [previousWorkspace, setPreviousWorkspace] = useState(activeWorkspace);
  if (previousWorkspace !== activeWorkspace) {
    setPreviousWorkspace(activeWorkspace);
    setBadgeCounts(countsCache.get(activeWorkspace) ?? {});
  }

  // Guards against overlapping polls: only one request per endpoint family is
  // in flight at a time, and the controller is aborted on unmount/switch.
  const inFlightRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const needed = neededQueries(activeWorkspace);
    if (needed.length === 0) return;

    let cancelled = false;

    const refresh = async () => {
      // Abort any request still in flight so polls never stack.
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;
      try {
        const entries = await Promise.all(
          needed.map(async (query) => {
            try {
              const res = await fetch(BADGE_ENDPOINTS[query], { signal: controller.signal });
              if (!res.ok) return [query, null] as const;
              const data = await res.json();
              return [query, Number(data?.data?.total ?? 0)] as const;
            } catch {
              // Aborted or network failure — keep the previous value for this
              // query (handled by the merge below).
              return [query, null] as const;
            }
          }),
        );
        // Discard stale results: either the effect was torn down, or a newer
        // poll aborted this controller (in which case the fresh poll will
        // merge its own results).
        if (cancelled || controller.signal.aborted) return;
        setBadgeCounts((prev) => {
          const next = { ...prev };
          for (const [query, count] of entries) {
            if (count !== null) next[query] = count;
          }
          countsCache.set(activeWorkspace, next);
          return next;
        });
      } finally {
        if (inFlightRef.current === controller) inFlightRef.current = null;
      }
    };

    void refresh();

    // Poll only while the tab is visible — background tabs don't churn the
    // badge endpoints.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      inFlightRef.current?.abort();
      inFlightRef.current = null;
      window.clearInterval(interval);
    };
  }, [activeWorkspace]);

  return badgeCounts;
}
