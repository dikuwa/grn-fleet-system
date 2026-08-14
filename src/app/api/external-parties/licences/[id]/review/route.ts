import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

const REVIEWABLE = new Set(['awaiting_review', 'needs_correction']);

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permissionCheck = await requireAnyPermission(session, [
      Permissions.DRIVER_REVIEW_LICENCE,
      Permissions.LICENCE_VERIFY,
    ]);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'verify' | 'reject' | 'request_upload';
      reason?: string;
    };
    const action = body.action;
    const reason = String(body.reason || '').trim();
    if (!action || !['verify', 'reject', 'request_upload'].includes(action)) {
      return NextResponse.json({ error: 'A valid review action is required' }, { status: 422 });
    }
    if (action !== 'verify' && (reason.length < 5 || reason.length > 1000)) {
      return NextResponse.json({ error: 'A review reason of 5–1,000 characters is required' }, { status: 422 });
    }

    const db = getDb();
    const [record] = await db
      .select({
        licence: externalDriverLicences,
        firstName: externalParties.firstName,
        lastName: externalParties.lastName,
        organisationName: externalParties.organisationName,
      })
      .from(externalDriverLicences)
      .innerJoin(externalParties, eq(externalParties.id, externalDriverLicences.externalPartyId))
      .where(
        and(
          eq(externalDriverLicences.id, id),
          eq(externalDriverLicences.tenantId, session.tenantId),
          eq(externalParties.tenantId, session.tenantId),
        ),
      )
      .limit(1);
    if (!record) return NextResponse.json({ error: 'External driver licence not found' }, { status: 404 });
    if (!REVIEWABLE.has(record.licence.verificationStatus)) {
      return NextResponse.json(
        { error: `Licence review is already terminal (${record.licence.verificationStatus})` },
        { status: 409 },
      );
    }

    const now = new Date();
    const expiry = new Date(`${record.licence.expiryDate}T23:59:59.999Z`);
    if (action === 'verify' && expiry < now) {
      return NextResponse.json({ error: 'An expired external licence cannot be verified for assignment' }, { status: 409 });
    }

    const nextStatus = action === 'verify' ? 'verified' : action === 'reject' ? 'rejected' : 'needs_correction';
    const [updated] = await db
      .update(externalDriverLicences)
      .set({
        verificationStatus: nextStatus,
        reviewNotes: reason || null,
        verifiedByUserId: action === 'verify' ? session.user.id : null,
        verifiedAt: action === 'verify' ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(externalDriverLicences.id, id),
          eq(externalDriverLicences.tenantId, session.tenantId),
          eq(externalDriverLicences.verificationStatus, record.licence.verificationStatus),
        ),
      )
      .returning();
    if (!updated) {
      return NextResponse.json({ error: 'Licence changed while it was being reviewed. Refresh and try again.' }, { status: 409 });
    }

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: `external_driver_licence.${action}`,
      entityType: 'external_driver_licence',
      entityId: id,
      before: { verificationStatus: record.licence.verificationStatus },
      after: { verificationStatus: nextStatus },
      reason: reason || undefined,
      summary: `External driver licence ${nextStatus}: ${record.firstName} ${record.lastName} (${record.organisationName})`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('[external-driver-licence-review] PATCH failed:', error);
    return NextResponse.json({ error: 'External driver licence review could not be saved' }, { status: 500 });
  }
}
