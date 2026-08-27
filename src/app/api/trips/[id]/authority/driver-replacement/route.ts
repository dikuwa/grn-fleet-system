import { NextRequest, NextResponse } from 'next/server';
import {
  requireAnyPermission,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { decidePostAuthorisationDriverReplacement } from '@/lib/driver-authority-replacement';
import { Permissions } from '@/lib/permissions';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(session, '/dashboard/approvals', 'approve');
    if (routeCheck instanceof NextResponse) return routeCheck;

    // This is a revision of an already authorised Trip Authority. Emergency
    // workflow bypass is intentionally excluded; only ordinary trip managers
    // or configured final-authorisation holders may decide the amendment.
    const permission = await requireAnyPermission(session, [
      Permissions.TRIP_MANAGE,
      Permissions.TRIP_AUTHORIZE_REGIONAL,
      Permissions.TRIP_AUTHORIZE_NATIONAL,
    ]);
    if (permission instanceof NextResponse) return permission;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      amendmentId?: string;
      action?: 'approve' | 'reject';
      comment?: string;
    };
    if (!body.amendmentId || !['approve', 'reject'].includes(body.action || '')) {
      return NextResponse.json(
        { error: 'Driver replacement amendment and decision are required.' },
        { status: 422 },
      );
    }
    const comment = body.comment?.trim() || '';
    if (comment.length > 1000) {
      return NextResponse.json({ error: 'Decision comment must be 1000 characters or fewer.' }, { status: 422 });
    }

    return decidePostAuthorisationDriverReplacement({
      tripId: id,
      amendmentId: body.amendmentId,
      action: body.action!,
      comment: comment || undefined,
      session,
    });
  } catch (error) {
    console.error('[authority/driver-replacement] PATCH failed:', error);
    return NextResponse.json(
      { error: 'The driver replacement decision could not be saved. Refresh and try again.' },
      { status: 500 },
    );
  }
}
