import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { externalDriverLicences, externalParties } from '@/db/schema/external-parties';
import { requireAnyPermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { buildKey, deleteFile, getSignedFileUrl, isStorageConfigured, uploadFile } from '@/lib/storage';
import { recordAuditEvent } from '@/lib/audit-event';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const MAX_BYTES = 12 * 1024 * 1024;

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

async function access(request: NextRequest, partyId: string) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permissionCheck = await requireAnyPermission(auth.session, [
    Permissions.DRIVER_MANAGE,
    Permissions.DRIVER_UPLOAD_LICENCE,
    Permissions.DRIVER_REVIEW_LICENCE,
  ]);
  if (permissionCheck instanceof NextResponse) {
    return { ok: false as const, error: permissionCheck };
  }
  const db = getDb();
  const [party] = await db
    .select()
    .from(externalParties)
    .where(
      and(
        eq(externalParties.id, partyId),
        eq(externalParties.tenantId, auth.session.tenantId),
        eq(externalParties.status, 'active'),
      ),
    )
    .limit(1);
  if (!party) {
    return {
      ok: false as const,
      error: NextResponse.json({ error: 'External party not found' }, { status: 404 }),
    };
  }
  return { ok: true as const, session: auth.session, party };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await access(request, id);
    if (!auth.ok) return auth.error;
    const db = getDb();
    const rows = await db
      .select()
      .from(externalDriverLicences)
      .where(
        and(
          eq(externalDriverLicences.externalPartyId, id),
          eq(externalDriverLicences.tenantId, auth.session.tenantId),
        ),
      )
      .orderBy(desc(externalDriverLicences.version), desc(externalDriverLicences.createdAt));

    const data = await Promise.all(
      rows.map(async (row) => ({
        ...row,
        frontUrl: await getSignedFileUrl(row.frontImageKey, 900),
        backUrl: await getSignedFileUrl(row.backImageKey, 900),
      })),
    );
    return NextResponse.json({ success: true, party: auth.party, data });
  } catch (error) {
    console.error('[external-party-licences] GET failed:', error);
    return NextResponse.json({ error: 'External driver licence records could not be loaded' }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let uploadedKeys: string[] = [];
  try {
    const { id } = await params;
    const auth = await access(request, id);
    if (!auth.ok) return auth.error;
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'Secure file storage is not configured' }, { status: 503 });
    }

    const form = await request.formData();
    const licenceNumber = String(form.get('licenceNumber') || '').trim();
    const licenceClass = String(form.get('licenceClass') || '').trim();
    const issueDate = String(form.get('issueDate') || '').trim();
    const expiryDate = String(form.get('expiryDate') || '').trim();
    const front = form.get('front');
    const back = form.get('back');

    if (!licenceNumber || !licenceClass || !validDate(expiryDate)) {
      return NextResponse.json(
        { error: 'Licence number, licence class and a valid expiry date are required' },
        { status: 422 },
      );
    }
    if (issueDate && !validDate(issueDate)) {
      return NextResponse.json({ error: 'Issue date is invalid' }, { status: 422 });
    }
    if (!(front instanceof File) || !(back instanceof File)) {
      return NextResponse.json({ error: 'Front and back licence evidence are required' }, { status: 422 });
    }
    for (const file of [front, back]) {
      if (!ACCEPTED_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_BYTES) {
        return NextResponse.json(
          { error: 'Licence evidence must be JPEG, PNG, WebP or PDF and no larger than 12 MB per file' },
          { status: 422 },
        );
      }
    }

    const db = getDb();
    const [versionRow] = await db
      .select({ nextVersion: sql<number>`COALESCE(MAX(${externalDriverLicences.version}), 0) + 1` })
      .from(externalDriverLicences)
      .where(
        and(
          eq(externalDriverLicences.externalPartyId, id),
          eq(externalDriverLicences.tenantId, auth.session.tenantId),
        ),
      );
    const version = Number(versionRow?.nextVersion || 1);
    const prefix = auth.session.tenantId;
    const frontKey = buildKey(front.name || 'licence-front', 'external-driver-licences', prefix);
    const backKey = buildKey(back.name || 'licence-back', 'external-driver-licences', prefix);
    await uploadFile(Buffer.from(await front.arrayBuffer()), frontKey, { contentType: front.type, tenantPrefix: prefix });
    uploadedKeys.push(frontKey);
    await uploadFile(Buffer.from(await back.arrayBuffer()), backKey, { contentType: back.type, tenantPrefix: prefix });
    uploadedKeys.push(backKey);

    const [created] = await db
      .insert(externalDriverLicences)
      .values({
        tenantId: auth.session.tenantId,
        externalPartyId: id,
        version,
        licenceNumber: licenceNumber.slice(0, 120),
        licenceClass: licenceClass.slice(0, 120),
        issueDate: issueDate || null,
        expiryDate,
        frontImageKey: frontKey,
        backImageKey: backKey,
        verificationStatus: 'awaiting_review',
        extractedData: {},
      })
      .returning();

    uploadedKeys = [];
    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'external_driver_licence.uploaded',
      entityType: 'external_driver_licence',
      entityId: created.id,
      after: {
        externalPartyId: id,
        version,
        licenceClass: created.licenceClass,
        expiryDate: created.expiryDate,
        verificationStatus: created.verificationStatus,
      },
      summary: `External driver licence evidence uploaded for ${auth.party.firstName} ${auth.party.lastName}`,
    }).catch(() => undefined);

    const recipients = await resolveActiveRoleRecipients(auth.session.tenantId, [SystemRoles.TRANSPORT_ADMIN]);
    if (recipients.length) {
      await createScopedNotifications({
        tenantId: auth.session.tenantId,
        recipientUserIds: recipients,
        category: 'action_required',
        eventType: 'external_driver_licence_review_pending',
        title: 'External driver licence requires review',
        body: `${auth.party.firstName} ${auth.party.lastName} (${auth.party.organisationName}) has new licence evidence awaiting verification.`,
        entityType: 'external_driver_licence',
        entityId: created.id,
        actionUrl: '/dashboard/drivers/external',
        workspace: WorkspaceIds.TRANSPORT_ADMIN,
        priority: 'high',
      }).catch(() => undefined);
    }

    return NextResponse.json({ success: true, data: created }, { status: 201 });
  } catch (error) {
    await Promise.all(uploadedKeys.map((key) => deleteFile(key).catch(() => undefined)));
    console.error('[external-party-licences] POST failed:', error);
    return NextResponse.json({ error: 'External driver licence evidence could not be saved' }, { status: 500 });
  }
}
