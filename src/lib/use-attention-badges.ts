'use client';

import { useEffect, useState } from 'react';
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
};

/**
 * Live attention counts for the badge queries used by a workspace's
 * navigation.
 *
 * @param activeWorkspace the currently active workspace
 * @returns a record keyed by badgeQuery → live count (0 when unset)
 */
export function useAttentionBadges(activeWorkspace: WorkspaceId) {
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    // Only fetch queries the workspace's navigation actually declares, and
    // only those we have an endpoint for.
    const needed = Array.from(
      new Set(
        getWorkspaceNavigation(activeWorkspace)
          .map((item) => item.badgeQuery)
          .filter((query): query is string => Boolean(query && BADGE_ENDPOINTS[query])),
      ),
    );
    if (needed.length === 0) return;

    let cancelled = false;
    Promise.all(
      needed.map(async (query) => {
        try {
          const res = await fetch(BADGE_ENDPOINTS[query]);
          const data = res.ok ? await res.json() : null;
          return [query, Number(data?.data?.total ?? 0)] as const;
        } catch {
          return [query, 0] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      setBadgeCounts(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [activeWorkspace]);

  return badgeCounts;
}
