/**
 * Insurance API
 *
 * PATCH /api/incidents/[id]/insurance — Update insurance workflow
 * GET /api/incidents/[id]/insurance — Fetch insurance state
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  updateInsurance,
  getTenantIncident,
} from '@/lib/incidents/mva';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.INCIDENT_INSURANCE_UPDATE);
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const incident = await getTenantIncident(session.tenantId, id);
    if (!incident) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    return NextResponse.json({
      data: {
        insuranceClaimReference: incident.insuranceClaimReference,
        insuranceNotified: incident.insuranceNotified,
        insuranceNotifiedAt: incident.insuranceNotifiedAt,
        policeReportFiled: incident.policeReportFiled,
        thirdPartyInsuranceDetails: incident.thirdPartyInsuranceDetails,
      },
    });
  } catch (error) {
    console.error('[incidents/insurance] GET failed:', error);
    return NextResponse.json({ error: 'Failed to fetch insurance' }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(
      session,
      Permissions.INCIDENT_INSURANCE_UPDATE,
    );
    if (permCheck instanceof NextResponse) return permCheck;

    const { id } = await params;
    const body = await req.json();

    const result = await updateInsurance(
      session.tenantId,
      id,
      session.user.id,
      {
        insuranceClaimReference: body.insuranceClaimReference,
        insuranceNotified: body.insuranceNotified,
        policeReportFiled: body.policeReportFiled,
        thirdPartyInsuranceDetails: body.thirdPartyInsuranceDetails,
      },
    );

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ data: result.data });
  } catch (error) {
    console.error('[incidents/insurance] PATCH failed:', error);
    return NextResponse.json({ error: 'Failed to update insurance' }, { status: 500 });
  }
}
