import { NextRequest, NextResponse } from 'next/server';
import { hasPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { resolveTripFleetPayment, resolveVehicleFleetPayment } from '@/lib/fleet-payments/service';

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const allowed = await Promise.all([
    hasPermission(session, Permissions.TENANT_MANAGE),
    hasPermission(session, Permissions.TRIP_MANAGE),
    hasPermission(session, Permissions.FUEL_MANAGE),
    hasPermission(session, Permissions.DRIVER_FUEL_CREATE),
    hasPermission(session, Permissions.DRIVER_LOG_CREATE),
  ]);
  if (!allowed.some(Boolean)) {
    return NextResponse.json({ error: 'Fleet payment assignment access is restricted.' }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const tripId = params.get('tripId')?.trim();
  const vehicleId = params.get('vehicleId')?.trim();
  if (!tripId && !vehicleId) {
    return NextResponse.json({ error: 'Provide a trip or vehicle.' }, { status: 400 });
  }

  const data = tripId
    ? await resolveTripFleetPayment({ tenantId: session.tenantId, tripId })
    : await resolveVehicleFleetPayment({ tenantId: session.tenantId, vehicleId: vehicleId! });
  return NextResponse.json({ success: true, data });
}
