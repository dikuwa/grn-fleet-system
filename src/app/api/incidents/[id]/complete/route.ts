/**
 * Incident Details Completion API
 *
 * POST /api/incidents/[id]/complete — Mark incident details as complete
 * (clears the `detailsRequired` flag after mandatory fields are verified).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { completeIncidentDetails } from '@/lib/incidents/mva';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(
      session,
      Permissions.INCIDENT_COMPLETE_DETAILS,
    );
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const result = await completeIncidentDetails(
      session.tenantId,
      id,
      session.user.id,
    );

    if (!result.ok) {
      const status = result.error === 'not_found'
        ? 404
        : result.error === 'incident_already_closed' || result.error === 'details_completion_conflict'
          ? 409
          : 400;
      const error = result.error === 'incident_already_closed'
        ? 'Closed incident evidence cannot be changed through details completion.'
        : result.error === 'details_completion_conflict'
          ? 'Incident details changed while completion was being recorded. Refresh and review the current incident state.'
          : result.error;
      return NextResponse.json({ error }, { status });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    console.error('[incidents/complete] POST failed:', error);
    return NextResponse.json({ error: 'Failed to complete incident details' }, { status: 500 });
  }
}
