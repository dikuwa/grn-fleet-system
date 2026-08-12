import { NextRequest, NextResponse } from 'next/server';
import { requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';

/**
 * GET /api/trips/readiness-dashboard
 *
 * Deprecated internal endpoint.
 *
 * This route previously reimplemented release-readiness rules independently
 * from /api/trips/[id]/readiness. The two implementations had diverged on
 * approval/release semantics, driver licence checks, authority validity,
 * vehicle-document checks, and the optional vehicle-issue step. Returning a
 * second, contradictory operational answer is more dangerous than failing
 * explicitly.
 *
 * The dashboard server page remains available at /dashboard/trips/readiness,
 * while per-trip operational decisions must use /api/trips/[id]/readiness.
 * A future dashboard refactor should consume a shared server readiness service
 * rather than recreate those business rules in another API route.
 */
export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  const routeCheck = await requireDashboardAction(session, '/dashboard/trips/readiness', 'view');
  if (routeCheck instanceof NextResponse) return routeCheck;

  return NextResponse.json(
    {
      error: 'This aggregate readiness API is deprecated because it duplicated operational release rules.',
      code: 'READINESS_DASHBOARD_API_DEPRECATED',
      replacement: '/api/trips/{tripId}/readiness',
      dashboard: '/dashboard/trips/readiness',
    },
    {
      status: 410,
      headers: {
        'Cache-Control': 'private, no-store',
        Deprecation: 'true',
      },
    },
  );
}
