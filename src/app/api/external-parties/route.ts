import { NextRequest, NextResponse } from 'next/server';
import { and, asc, desc, eq, ilike, inArray, or } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

const READ_PERMISSIONS = [
  Permissions.SECURE_REQUEST_ASSIST,
  Permissions.DRIVER_MANAGE,
  Permissions.DRIVER_REVIEW_LICENCE,
] as const;

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permissionCheck = await requireAnyPermission(session, [...READ_PERMISSIONS]);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const q = request.nextUrl.searchParams.get('q')?.trim().slice(0, 100) || '';
    const driverReady = request.nextUrl.searchParams.get('driverReady') === 'true';
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 50));
    const db = getDb();
    const conditions = [
      eq(externalParties.tenantId, session.tenantId),
      eq(externalParties.status, 'active'),
    ];
    if (q) {
      conditions.push(
        or(
          ilike(externalParties.firstName, `%${q}%`),
          ilike(externalParties.lastName, `%${q}%`),
          ilike(externalParties.organisationName, `%${q}%`),
          ilike(externalParties.email, `%${q}%`),
        )!,
      );
    }

    const parties = await db
      .select()
      .from(externalParties)
      .where(and(...conditions))
      .orderBy(asc(externalParties.lastName), asc(externalParties.firstName))
      .limit(limit);

    if (!parties.length) return NextResponse.json({ success: true, data: [] });

    const licences = await db
      .select({
        id: externalDriverLicences.id,
        externalPartyId: externalDriverLicences.externalPartyId,
        version: externalDriverLicences.version,
        licenceNumber: externalDriverLicences.licenceNumber,
        licenceClass: externalDriverLicences.licenceClass,
        expiryDate: externalDriverLicences.expiryDate,
        verificationStatus: externalDriverLicences.verificationStatus,
        createdAt: externalDriverLicences.createdAt,
      })
      .from(externalDriverLicences)
      .where(
        and(
          eq(externalDriverLicences.tenantId, session.tenantId),
          inArray(
            externalDriverLicences.externalPartyId,
            parties.map((party) => party.id),
          ),
        ),
      )
      .orderBy(desc(externalDriverLicences.version), desc(externalDriverLicences.createdAt));

    const latestLicenceByParty = new Map<string, (typeof licences)[number]>();
    for (const licence of licences) {
      if (!latestLicenceByParty.has(licence.externalPartyId)) {
        latestLicenceByParty.set(licence.externalPartyId, licence);
      }
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const data = parties
      .map((party) => {
        const latestLicence = latestLicenceByParty.get(party.id) ?? null;
        const licenceExpiry = latestLicence
          ? new Date(`${latestLicence.expiryDate}T23:59:59.999Z`)
          : null;
        const isDriverReady =
          latestLicence?.verificationStatus === 'verified' &&
          !!licenceExpiry &&
          licenceExpiry >= today;
        return {
          ...party,
          fullName: `${party.firstName} ${party.lastName}`.trim(),
          latestLicence,
          isDriverReady,
        };
      })
      .filter((party) => !driverReady || party.isDriverReady);

    return NextResponse.json(
      { success: true, data },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    console.error('[external-parties] GET failed:', error);
    return NextResponse.json({ error: 'External parties could not be loaded' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permissionCheck = await requireAnyPermission(session, [
      Permissions.SECURE_REQUEST_ASSIST,
      Permissions.DRIVER_MANAGE,
    ]);
    if (permissionCheck instanceof NextResponse) return permissionCheck;

    const body = (await request.json().catch(() => ({}))) as {
      firstName?: string;
      lastName?: string;
      organisationName?: string;
      organisationType?: string;
      idReference?: string;
      email?: string;
      phone?: string;
      notes?: string;
    };
    const firstName = String(body.firstName || '').trim();
    const lastName = String(body.lastName || '').trim();
    const organisationName = String(body.organisationName || '').trim();
    if (!firstName || !lastName || !organisationName) {
      return NextResponse.json(
        { error: 'First name, last name and organisation are required' },
        { status: 422 },
      );
    }
    if (firstName.length > 120 || lastName.length > 120 || organisationName.length > 240) {
      return NextResponse.json({ error: 'External party details are too long' }, { status: 422 });
    }

    const db = getDb();
    const [created] = await db
      .insert(externalParties)
      .values({
        tenantId: session.tenantId,
        firstName,
        lastName,
        organisationName,
        organisationType: String(body.organisationType || 'other').trim().slice(0, 80) || 'other',
        idReference: String(body.idReference || '').trim().slice(0, 120) || null,
        email: String(body.email || '').trim().slice(0, 240) || null,
        phone: String(body.phone || '').trim().slice(0, 80) || null,
        notes: String(body.notes || '').trim().slice(0, 1000) || null,
        createdByUserId: session.user.id,
      })
      .returning();

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'external_party.created',
      entityType: 'external_party',
      entityId: created.id,
      after: {
        organisationName: created.organisationName,
        organisationType: created.organisationType,
      },
      summary: `External party created for ${created.organisationName}`,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    console.error('[external-parties] POST failed:', error);
    return NextResponse.json({ error: 'External party could not be created' }, { status: 500 });
  }
}
