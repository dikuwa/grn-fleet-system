import { NextRequest, NextResponse } from 'next/server';
import { getSessionPermissions, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;

    const permissions = await getSessionPermissions(auth.session);
    const has = (permission: (typeof Permissions)[keyof typeof Permissions]) =>
      permissions.includes(permission);

    return NextResponse.json({
      capabilities: {
        canManage: has(Permissions.TRIP_INCIDENT_MANAGE),
        canCompleteDetails: has(Permissions.INCIDENT_COMPLETE_DETAILS),
        canInvestigate: has(Permissions.INCIDENT_INVESTIGATE),
        canCloseInvestigation: has(Permissions.INCIDENT_CLOSE_INVESTIGATION),
        canTechnicalClearance: has(Permissions.INCIDENT_TECHNICAL_CLEARANCE),
        canInsuranceUpdate: has(Permissions.INCIDENT_INSURANCE_UPDATE),
        canGenerateMva: has(Permissions.INCIDENT_INVESTIGATE),
        canViewFiles: has(Permissions.FILE_VIEW),
      },
    });
  } catch (error) {
    console.error('[incidents/capabilities] GET failed:', error);
    return NextResponse.json({ error: 'Failed to resolve incident capabilities' }, { status: 500 });
  }
}
