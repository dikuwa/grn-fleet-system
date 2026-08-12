import { NextRequest, NextResponse } from 'next/server';
import {
  requireDashboardAction,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  completeOfficialInspection,
  InspectionServiceError,
} from '@/lib/inspection-service';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const routeCheck = await requireDashboardAction(
      session,
      '/dashboard/inspections/new',
      'create',
    );
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permissionCheck = await requirePermission(session, Permissions.INSPECTION_PERFORM);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const body = await request.json();
    const checklist = Array.isArray(body.checklist) ? body.checklist : [];
    const assessedItems = checklist.filter(
      (item: { result?: unknown }) => item?.result === 'pass' || item?.result === 'fail',
    );
    if (checklist.length > 0 && assessedItems.length === 0) {
      return NextResponse.json(
        {
          error:
            'The inspection cannot be completed with every checklist item marked not applicable. Assess each applicable item as pass or fail.',
        },
        { status: 422 },
      );
    }

    const result = await completeOfficialInspection({
      tenantId: session.tenantId,
      userId: session.user.id,
      vehicleId: body.vehicleId,
      tripId: body.tripId,
      type: body.type,
      odometerReading: Number(body.odometerReading),
      fuelLevel: body.fuelLevel,
      checklist,
      notes: body.notes,
      photoKeys: Array.isArray(body.photoKeys) ? body.photoKeys : [],
      inspectorAcknowledged: body.inspectorAcknowledged === true,
      driverAcknowledged: body.driverAcknowledged === true,
      clientSyncId: typeof body.clientSyncId === 'string' ? body.clientSyncId : null,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof InspectionServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[inspections] POST failed:', error);
    return NextResponse.json({ error: 'Failed to complete inspection' }, { status: 500 });
  }
}
