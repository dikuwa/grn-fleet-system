import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { getDb } from '@/db';
import {
  driverLicenceCodes,
  driverLicenceCorrections,
  driverLicences,
  driverProfiles,
  employees,
} from '@/db/schema';
import { and, desc, eq, ne, sql } from 'drizzle-orm';
import {
  getSessionWorkspace,
  hasPermission,
  requireAnyPermission,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { WorkspaceIds } from '@/lib/workspaces';
import { buildKey, isStorageConfigured, uploadFile } from '@/lib/storage';
import { licenceOcrConfidence, parseNamibianLicenceOcr } from '@/lib/driver-licence-ocr';
import { recordAuditEvent } from '@/lib/audit-event';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';

/** The operational role that receives actionable licence-renewal reviews. */
const REVIEW_ROLES = ['Transport Administrator'] as const;

async function notifyTransportAdmins(tenantId: string, input: {
  title: string;
  body: string;
  entityType: string;
  entityId: string;
  actionUrl: string;
}) {
  try {
    const recipients = await resolveActiveRoleRecipients(tenantId, REVIEW_ROLES);
    if (!recipients.length) return;
    await createScopedNotifications({
      tenantId,
      recipientUserIds: recipients,
      category: 'action_required',
      eventType: 'driver_licence_review_pending',
      title: input.title,
      body: input.body,
      entityType: input.entityType,
      entityId: input.entityId,
      actionUrl: input.actionUrl,
      workspace: 'transport_admin',
    });
  } catch (error) {
    console.warn('[licences] admin notification failed:', error);
  }
}

async function notifyDriver(
  tenantId: string,
  driverUserId: string | null | undefined,
  driverEmail: string | null | undefined,
  driverName: string | null | undefined,
  input: { title: string; body: string; entityType: string; entityId: string; actionUrl: string },
) {
  try {
    if (driverUserId) {
      await createScopedNotifications({
        tenantId,
        recipientUserIds: [driverUserId],
        category: 'outcome',
        eventType: 'driver_licence_review',
        title: input.title,
        body: input.body,
        entityType: input.entityType,
        entityId: input.entityId,
        actionUrl: input.actionUrl,
        workspace: 'driver',
      });
    }
    if (driverEmail) {
      const { sendNotificationEmail } = await import('@/lib/email');
      await sendNotificationEmail({
        to: driverEmail,
        type: 'licence_review',
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl,
        recipientName: driverName || 'Driver',
      });
    }
  } catch (error) {
    console.warn('[licences] driver notification failed:', error);
  }
}

const accepted = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const maxBytes = 12 * 1024 * 1024;

function masked(value: string): string {
  return value.length > 4 ? `••••${value.slice(-4)}` : '••••';
}

function expiresAfterToday(expiryDate: string, now = new Date()) {
  return new Date(`${expiryDate}T23:59:59Z`) >= now;
}

async function access(request: NextRequest, employeeId: string) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const db = getDb();
  const [employee] = await db.select({ id: employees.id, userId: employees.userId })
    .from(employees).where(and(eq(employees.id, employeeId), eq(employees.tenantId, auth.session.tenantId))).limit(1);
  if (!employee) return { ok: false as const, error: NextResponse.json({ error: 'Driver not found' }, { status: 404 }) };
  const canManage = await hasPermission(auth.session, Permissions.DRIVER_MANAGE);
  const isOwn = employee.userId === auth.session.user.id;
  if (!canManage && !isOwn) return { ok: false as const, error: NextResponse.json({ error: 'You may only access your own licence' }, { status: 403 }) };
  return { ok: true as const, session: auth.session, employee, canManage };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await access(request, id);
  if (!auth.ok) return auth.error;
  const db = getDb();
  const rows = await db.select({
    id: driverLicences.id,
    licenceNumber: driverLicences.licenceNumber,
    issueDate: driverLicences.issueDate,
    expiryDate: driverLicences.expiryDate,
    issueNumber: driverLicences.issueNumber,
    verificationStatus: driverLicences.verificationStatus,
    version: driverLicences.version,
    isActive: driverLicences.isActive,
    frontImageKey: driverLicences.frontImageKey,
    backImageKey: driverLicences.backImageKey,
    ocrConfidence: driverLicences.ocrConfidence,
    entryMethod: driverLicences.entryMethod,
  }).from(driverLicences)
    .innerJoin(driverProfiles, eq(driverProfiles.id, driverLicences.driverProfileId))
    .where(eq(driverProfiles.employeeId, id))
    .orderBy(desc(driverLicences.version));
  const data = auth.canManage ? rows : rows.map((row) => ({
    ...row,
    licenceNumber: row.licenceNumber.length > 4 ? `••••${row.licenceNumber.slice(-4)}` : '••••',
  }));
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await access(request, id);
  if (!auth.ok) return auth.error;
  const permission = await requireAnyPermission(auth.session, [Permissions.FILE_UPLOAD, Permissions.DRIVER_MANAGE]);
  if (permission instanceof NextResponse) return permission;
  if (!isStorageConfigured()) return NextResponse.json({ error: 'Secure document storage is not configured.' }, { status: 503 });
  const form = await request.formData();
  const front = form.get('front');
  const back = form.get('back');
  const sourcePdf = form.get('sourcePdf');
  const manual = form.get('manual') === 'true';
  const files = [front, back, sourcePdf].filter((file): file is File => file instanceof File && file.size > 0);
  if (!manual && (!(front instanceof File) || !(back instanceof File))) {
    return NextResponse.json({ error: 'Front and back licence images are required.' }, { status: 400 });
  }
  if (files.some((file) => !accepted.has(file.type) || file.size > maxBytes)) {
    return NextResponse.json({ error: 'Use JPEG, PNG, WebP or PDF files up to 12 MB.' }, { status: 400 });
  }
  const db = getDb();
  const [profile] = await db.select().from(driverProfiles).where(eq(driverProfiles.employeeId, id)).limit(1);
  if (!profile) return NextResponse.json({ error: 'Create a driver profile before uploading a licence.' }, { status: 409 });
  const [latest] = await db.select({ version: driverLicences.version }).from(driverLicences)
    .where(eq(driverLicences.driverProfileId, profile.id)).orderBy(desc(driverLicences.version)).limit(1);
  const version = (latest?.version || 0) + 1;
  const tenantPrefix = `tenant/${auth.session.tenantId}`;
  const uploaded: Record<string, string> = {};
  for (const [side, value] of [['front', front], ['back', back], ['sourcePdf', sourcePdf]] as const) {
    if (!(value instanceof File) || !value.size) continue;
    const key = buildKey(value.name, `driver-licences/${id}/v${version}/${side}`, tenantPrefix);
    await uploadFile(Buffer.from(await value.arrayBuffer()), key, { contentType: value.type });
    uploaded[side] = key;
  }

  let rawText = '';
  let meanConfidence = 0;
  const qualityWarnings: string[] = [];
  const images = [front, back].filter((file): file is File => file instanceof File && file.type.startsWith('image/'));
  if (images.length) {
    const worker = await createWorker('eng');
    try {
      for (const image of images) {
        const original = Buffer.from(await image.arrayBuffer());
        const stats = await sharp(original).stats();
        const brightness = stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
        if (brightness < 55) qualityWarnings.push('dark_image');
        if (brightness > 225) qualityWarnings.push('possible_glare');
        const prepared = await sharp(original).rotate().resize({ width: 1800, withoutEnlargement: true }).grayscale().normalize().sharpen().png().toBuffer();
        const result = await worker.recognize(prepared);
        rawText += `\n${result.data.text}`;
        meanConfidence += result.data.confidence;
      }
      meanConfidence /= images.length;
    } catch {
      qualityWarnings.push('ocr_failed_manual_entry_required');
    } finally {
      await worker.terminate();
    }
  }
  const extracted = parseNamibianLicenceOcr(rawText);
  const confidence = licenceOcrConfidence(extracted, meanConfidence);
  const licenceNumber = String(form.get('licenceNumber') || extracted.licenceNumber || `PENDING-${Date.now()}`);
  const issueDate = String(form.get('issueDate') || extracted.validFrom || new Date().toISOString().slice(0, 10));
  const expiryDate = String(form.get('expiryDate') || extracted.validUntil || issueDate);

  // A renewal submission is provisional until a Transport Administrator approves it.
  // Keep the currently verified licence active during review; the approval transition
  // below is the only place that supersedes the previous operational version.
  const [licence] = await db.insert(driverLicences).values({
    driverProfileId: profile.id,
    licenceNumber,
    licenceClass: extracted.licenceCodes.join(',') || String(form.get('licenceClass') || 'PENDING'),
    issueDate,
    expiryDate,
    holderName: extracted.holderName || String(form.get('holderName') || '') || null,
    dateOfBirth: extracted.dateOfBirth || null,
    nationalIdNumber: extracted.nationalIdNumber || null,
    driverRestrictionCode: extracted.driverRestrictionCode || null,
    issueNumber: extracted.issueNumber || null,
    frontImageKey: uploaded.front || null,
    backImageKey: uploaded.back || null,
    sourcePdfKey: uploaded.sourcePdf || null,
    rawOcrResult: { text: rawText, extracted, qualityWarnings },
    ocrConfidence: confidence,
    ocrProvider: images.length ? 'tesseract.js' : null,
    entryMethod: rawText ? 'ocr_review' : 'manual',
    version,
    verificationStatus: rawText ? 'awaiting_review' : 'needs_correction',
    isActive: false,
    isVerified: false,
  }).returning();
  const codes = extracted.licenceCodes.length ? extracted.licenceCodes : String(form.get('licenceClass') || '').split(',').map((code) => code.trim()).filter(Boolean);
  if (codes.length) await db.insert(driverLicenceCodes).values(codes.map((code) => ({ licenceId: licence.id, code })));
  await recordAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.user.id,
    actorEmployeeId: id,
    action: 'driver_licence.uploaded',
    entityType: 'driver_licence',
    entityId: licence.id,
    after: {
      version,
      verificationStatus: licence.verificationStatus,
      isActive: false,
      previousVerifiedLicencePreserved: true,
      qualityWarnings,
      extractedFields: Object.keys(extracted),
    },
    summary: `Driver licence version ${version} uploaded for employee ${id}`,
  });

  if (licence.verificationStatus === 'awaiting_review' || licence.verificationStatus === 'needs_correction') {
    await notifyTransportAdmins(auth.session.tenantId, {
      title: 'Driver licence renewal pending review',
      body: `A renewed licence (version ${version}) was submitted for driver ${id.slice(0, 8)} and awaits verification.`,
      entityType: 'driver_licence',
      entityId: licence.id,
      actionUrl: `/dashboard/drivers/licences/${licence.id}`,
    });
  }
  return NextResponse.json({ data: licence, extracted, confidence, qualityWarnings, manualEntryRequired: !rawText }, { status: 201 });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await access(request, id);
  if (!auth.ok) return auth.error;
  const body = await request.json() as {
    licenceId: string;
    action: 'correct' | 'verify' | 'approve' | 'reject' | 'request_upload';
    corrections?: Record<string, string>;
    reason?: string;
  };
  const db = getDb();
  const [licence] = await db.select().from(driverLicences)
    .innerJoin(driverProfiles, eq(driverProfiles.id, driverLicences.driverProfileId))
    .where(and(eq(driverLicences.id, body.licenceId), eq(driverProfiles.employeeId, id))).limit(1);
  if (!licence) return NextResponse.json({ error: 'Licence record not found' }, { status: 404 });
  if (body.action !== 'correct') {
    const workspace = await getSessionWorkspace(auth.session);
    if (workspace.activeWorkspace !== WorkspaceIds.TRANSPORT_ADMIN) {
      return NextResponse.json(
        { error: 'Licence review decisions are available only in the Transport Administration workspace.' },
        { status: 403 },
      );
    }
    const permission = await requirePermission(auth.session, Permissions.DRIVER_REVIEW_LICENCE);
    if (permission instanceof NextResponse) return permission;
  }
  const current = licence.driver_licences;
  if (body.action === 'correct') {
    const allowed = ['licenceNumber', 'licenceClass', 'issueDate', 'expiryDate', 'holderName', 'dateOfBirth', 'nationalIdNumber', 'issueNumber', 'driverRestrictionCode'];
    const corrections = Object.entries(body.corrections || {}).filter(([field]) => allowed.includes(field));
    if (!corrections.length) return NextResponse.json({ error: 'No valid corrections supplied' }, { status: 400 });
    await db.insert(driverLicenceCorrections).values(corrections.map(([fieldName, correctedValue]) => ({
      licenceId: current.id,
      fieldName,
      originalValue: String((current as unknown as Record<string, unknown>)[fieldName] || ''),
      correctedValue,
      correctedByUserId: auth.session.user.id,
      source: 'ocr_review',
    })));
    await db.update(driverLicences).set({
      ...(Object.fromEntries(corrections) as Partial<typeof driverLicences.$inferInsert>),
      verificationStatus: 'awaiting_review',
      isActive: false,
      updatedAt: new Date(),
    }).where(eq(driverLicences.id, current.id));
  } else if (body.action === 'verify' || body.action === 'approve') {
    if (!current.frontImageKey || !current.backImageKey) return NextResponse.json({ error: 'Front and back images are required before verification.' }, { status: 409 });
    if (body.action === 'approve' && body.corrections) {
      const allowed = ['licenceNumber', 'licenceClass', 'issueDate', 'expiryDate', 'holderName', 'dateOfBirth', 'nationalIdNumber', 'issueNumber', 'driverRestrictionCode'];
      const confirmed = Object.entries(body.corrections).filter(([field]) => allowed.includes(field));
      if (confirmed.length) {
        await db.insert(driverLicenceCorrections).values(confirmed.map(([fieldName, correctedValue]) => ({
          licenceId: current.id,
          fieldName,
          originalValue: String((current as unknown as Record<string, unknown>)[fieldName] ?? ''),
          correctedValue: String(correctedValue),
          correctedByUserId: auth.session.user.id,
          source: 'review_approval',
        })));
        await db.update(driverLicences).set({
          ...(Object.fromEntries(confirmed) as Partial<typeof driverLicences.$inferInsert>),
          updatedAt: new Date(),
        }).where(eq(driverLicences.id, current.id));
      }
    }

    const [reviewed] = await db
      .select({ expiryDate: driverLicences.expiryDate })
      .from(driverLicences)
      .where(eq(driverLicences.id, current.id))
      .limit(1);
    const approvedExpiry = reviewed?.expiryDate ?? current.expiryDate;
    const isCurrent = expiresAfterToday(approvedExpiry);

    await db.transaction(async (tx) => {
      if (isCurrent) {
        await tx.update(driverLicences)
          .set({
            isActive: false,
            verificationStatus: sql`CASE WHEN ${driverLicences.verificationStatus} = 'verified' THEN 'superseded' ELSE ${driverLicences.verificationStatus} END`,
            updatedAt: new Date(),
          })
          .where(and(
            eq(driverLicences.driverProfileId, current.driverProfileId),
            eq(driverLicences.isActive, true),
            ne(driverLicences.id, current.id),
          ));
      }

      await tx.update(driverLicences).set({
        verificationStatus: isCurrent ? 'verified' : 'expired',
        isActive: isCurrent,
        isVerified: true,
        verifiedByUserId: auth.session.user.id,
        verifiedAt: new Date(),
        rejectionReason: null,
        updatedAt: new Date(),
      }).where(eq(driverLicences.id, current.id));

      if (isCurrent) {
        const [profileState] = await tx
          .select({ availabilityStatus: driverProfiles.availabilityStatus })
          .from(driverProfiles)
          .where(eq(driverProfiles.id, current.driverProfileId))
          .limit(1);
        await tx.update(driverProfiles).set({
          driverStatus: 'authorised',
          availabilityStatus:
            profileState?.availabilityStatus === 'unavailable' ? 'available' : profileState?.availabilityStatus || 'available',
          lastVerifiedAt: new Date(),
          verifiedByUserId: auth.session.user.id,
          updatedAt: new Date(),
        }).where(eq(driverProfiles.id, current.driverProfileId));
      }
    });
  } else {
    if (!body.reason?.trim()) return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    await db.update(driverLicences).set({
      verificationStatus: body.action === 'reject' ? 'rejected' : 'needs_correction',
      isActive: false,
      isVerified: false,
      rejectionReason: body.reason,
      updatedAt: new Date(),
    }).where(eq(driverLicences.id, current.id));
  }
  await recordAuditEvent({
    tenantId: auth.session.tenantId,
    actorUserId: auth.session.user.id,
    actorEmployeeId: id,
    action: `driver_licence.${body.action}`,
    entityType: 'driver_licence',
    entityId: current.id,
    before: { verificationStatus: current.verificationStatus, isActive: current.isActive },
    after: body.corrections || { action: body.action },
    reason: body.reason,
  });

  const [driverRow] = await db
    .select({ userId: employees.userId, email: employees.email, firstName: employees.firstName })
    .from(employees)
    .where(eq(employees.id, id))
    .limit(1);
  const outcomeMap: Record<string, { title: string; body: string }> = {
    verify: {
      title: 'Your driving licence has been verified',
      body: `Licence ${masked(current.licenceNumber)} (${current.licenceClass}) has been reviewed.`,
    },
    approve: {
      title: 'Your licence renewal has been approved',
      body: `Licence ${masked(current.licenceNumber)} (${current.licenceClass}) has been reviewed and approved.`,
    },
    reject: {
      title: 'Your licence renewal was rejected',
      body: `Licence ${masked(current.licenceNumber)} was rejected: ${body.reason ?? 'No reason provided'}`,
    },
    request_upload: {
      title: 'Action needed on your licence submission',
      body: `Your licence submission needs changes: ${body.reason ?? 'Please re-upload clear images.'}`,
    },
  };
  const outcome = outcomeMap[body.action];
  if (outcome && (driverRow?.userId || driverRow?.email)) {
    await notifyDriver(
      auth.session.tenantId,
      driverRow.userId,
      driverRow.email,
      driverRow.firstName,
      {
        title: outcome.title,
        body: outcome.body,
        entityType: 'driver_licence',
        entityId: current.id,
        actionUrl: '/dashboard/driver-self-service',
      },
    );
  }

  return NextResponse.json({ success: true });
}
