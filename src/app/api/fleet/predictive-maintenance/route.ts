import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { generatePredictions } from '@/lib/predictive-maintenance';

/**
 * GET /api/fleet/predictive-maintenance
 * Returns maintenance predictions for all active vehicles
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.VEHICLE_VIEW);
    if (permCheck instanceof NextResponse) return permCheck;

    const result = await generatePredictions(session.tenantId);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[predictive-maintenance] GET failed:', error);
    return NextResponse.json({ error: 'Failed to generate predictions' }, { status: 500 });
  }
}
