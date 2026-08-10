import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { createWorker } from 'tesseract.js';
import { getDb } from '@/db';
import {
  auditEvents,
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
import { buildKey, deleteFile, isStorageConfigured, uploadFile } from '@/lib/storage';
import { licenceOcrConfidence, parseNamibianLicenceOcr } from '@/lib/driver-licence-ocr';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { runAtomicMutations } from '@/lib/db-atomic';

const REVIEW_ROLES = ['Transport Administrator'] as const;
const REVIEWABLE_STATUSES = new Set(['awaiting_review', 'needs_correction', 'uploaded', 'pending']);
const TERMINAL_STATUSES = new Set(['verified', 'expired', 'superseded', 'rejected']);
const CORRECTABLE_FIELDS = [
  'licenceNumber',
  'licenceClass',
  'issueDate',
  'expiryDate',
  'holderName',
  'dateOfBirth',
  'nationalIdNumber',
  'issueNumber',
  'driverRestrictionCode',
] as const;
const accepted = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
const maxBytes = 12 * 1024 * 1024;

function masked(value: string): string {
  return value.length > 4 ? `••••${value.slice(-4)}` : '••••';
}

function validDateOnly(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime());
}

function expiresAfterToday(expiryDate: string, now = new Date()) {
  return new Date(`${expiryDate}T23:59:59Z`) >= now;
}

function correctionEntries(input?: Record<string, string>) {
  const allowed = new Set<string>(CORRECTABLE_FIELDS);
  return Object.entries(input || {}).filter(([field]) => allowed.has(field));
}

async function notifyTransportAdmins(
  tenantId: string,
  input: { title: string; body: string; entityType: string; entityId: string; actionUrl: string },
) {
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
      workspace: WorkspaceIds.TRANSPORT_ADMIN,
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
    const work: Promise<unknown>[] = [];
    if (driverUserId) {
      work.push(
        createScopedNotifications({
          tenantId,
          recipientUserIds: [driverUserId],
          category: 'outcome',
          eventType: 'driver_licence_review',
          title: input.title,
          body: input.body,
          entityType: input.entityType,
          entityId: input.entityId,
          actionUrl: input.actionUrl,
          workspace: WorkspaceIds.DRIVER,
        }),
      );
    }
    if (driverEmail) {
      work.push(
        import('@/lib/email').then(({ sendNotificationEmail }) =>
          sendNotificationEmail({
            to: driverEmail,
            type: 'licence_review',
            title: input.title,
            body: input.body,
            actionUrl: input.actionUrl,
            recipientName: driverName || 'Driver',
          }),
        ),
      );
    }
    await Promise.allSettled(work);
  } catch (error) {
    console.warn('[licences] driver notification failed:', error);
  }
}

async function access(request: NextRequest, employeeId: string) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const db = getDb();
  const [employee] = await db
    .select({ id: employees.id, userId: employees.userId })
    .from(employees)
    .where(and(eq(employees.id, employeeId), eq(employees.tenantId, auth.session.tenantId)))
    .limit(1);
  if (!employee) {
    return {
      ok: false as const,
      error: NextResponse.json({ error: 'Driver not found' }, { status: 404 }),
    };
  }
  const canManage = await hasPermission(auth.session, Permissions.DRIVER_MANAGE);
  const isOwn = employee.userId === auth.session.user.id;
  if (!canManage && !isOwn) {
    return {
      ok: false as const,
      error: NextResponse.json({ error: 'You may only access your own licence' }, { status: 403 }),
    };
  }
  return { ok: true as const, session: auth.session, employee, canManage };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await access(request, id);
  if (!auth.ok) return auth.error;
  const db = getDb();
  const rows = await db
    .select({
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
    })
    .from(driverLicences)
    .innerJoin(driverProfiles, eq(driverProfiles.id, driverLicences.driverProfileId))
    .where(eq(driverProfiles.employeeId, id))
    .orderBy(desc(driverLicences.version));
  const data = auth.canManage
    ? rows
    : rows.map((row) => ({ ...row, licenceNumber: masked(row.licenceNumber) }));
  return NextResponse.json({ data });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const uploadedKeys: string[] = [];
  let submissionCommitted = false;

  try {
    const { id } = await params;
    const auth = await access(request, id);
    if (!auth.ok) return auth.error;
    const permission = await requireAnyPermission(auth.session, [
      Permissions.FILE_UPLOAD,
      Permissions.DRIVER_MANAGE,
    ]);
    if (permission instanceof NextResponse) return permission;
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'Secure document storage is not configured.' }, { status: 503 });
    }

    const form = await request.formData();
    const front = form.get('front');
    const back = form.get('back');
    const sourcePdf = form.get('sourcePdf');
    const manual = form.get('manual') === 'true';
    const files = [front, back, sourcePdf].filter(
      (file): file is File => file instanceof File && file.size > 0,
    );
    if (!manual && (!(front instanceof File) || !(back instanceof File))) {
      return NextResponse.json({ error: 'Front and back licence images are required.' }, { status: 400 });
    }
    if (files.some((file) => !accepted.has(file.type) || file.size > maxBytes)) {
      return NextResponse.json({ error: 'Use JPEG, PNG, WebP or PDF files up to 12 MB.' }, { status: 400 });
    }

    const db = getDb();
    const [profile] = await db
      .select()
      .from(driverProfiles)
      .where(eq(driverProfiles.employeeId, id))
      .limit(1);
    if (!profile) {
      return NextResponse.json(
        { error: 'Create a driver profile before uploading a licence.' },
        { status: 409 },
      );
    }

    const [latest] = await db
      .select({ version: driverLicences.version })
      .from(driverLicences)
      .where(eq(driverLicences.driverProfileId, profile.id))
      .orderBy(desc(driverLicences.version))
      .limit(1);
    const version = (latest?.version || 0) + 1;

    // OCR and structural validation happen before storage writes. A bad date,
    // malformed submission or OCR-processing problem therefore cannot leave
    // unattached licence objects in R2.
    let rawText = '';
    let meanConfidence = 0;
    const qualityWarnings: string[] = [];
    const images = [front, back].filter(
      (file): file is File => file instanceof File && file.type.startsWith('image/'),
    );
    if (images.length) {
      const worker = await createWorker('eng');
      try {
        for (const image of images) {
          const original = Buffer.from(await image.arrayBuffer());
          const stats = await sharp(original).stats();
          const brightness =
            stats.channels.slice(0, 3).reduce((sum, channel) => sum + channel.mean, 0) / 3;
          if (brightness < 55) qualityWarnings.push('dark_image');
          if (brightness > 225) qualityWarnings.push('possible_glare');
          const prepared = await sharp(original)
            .rotate()
            .resize({ width: 1800, withoutEnlargement: true })
            .grayscale()
            .normalize()
            .sharpen()
            .png()
            .toBuffer();
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
    const licenceNumber = String(
      form.get('licenceNumber') || extracted.licenceNumber || `PENDING-${Date.now()}`,
    ).trim();
    const issueDate = String(
      form.get('issueDate') || extracted.validFrom || new Date().toISOString().slice(0, 10),
    );
    const expiryDate = String(form.get('expiryDate') || extracted.validUntil || issueDate);
    if (!validDateOnly(issueDate) || !validDateOnly(expiryDate)) {
      return NextResponse.json({ error: 'Licence issue and expiry dates must be valid dates.' }, { status: 422 });
    }
    if (new Date(`${expiryDate}T23:59:59Z`) < new Date(`${issueDate}T00:00:00Z`)) {
      return NextResponse.json({ error: 'Licence expiry date cannot be before its issue date.' }, { status: 422 });
    }

    const codes = (
      extracted.licenceCodes.length
        ? extracted.licenceCodes
        : String(form.get('licenceClass') || '').split(',')
    )
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean);
    const licenceClass = codes.join(',') || 'PENDING';
    const licenceId = randomUUID();
    const verificationStatus = rawText ? 'awaiting_review' : 'needs_correction';

    // Only structurally valid submissions reach object storage. Track every key
    // as it succeeds so a partial upload or rolled-back database transaction can
    // clean up only the objects created by this request.
    const tenantPrefix = `tenant/${auth.session.tenantId}`;
    const uploaded: Record<string, string> = {};
    for (const [side, value] of [
      ['front', front],
      ['back', back],
      ['sourcePdf', sourcePdf],
    ] as const) {
      if (!(value instanceof File) || !value.size) continue;
      const key = buildKey(value.name, `driver-licences/${id}/v${version}/${side}`, tenantPrefix);
      await uploadFile(Buffer.from(await value.arrayBuffer()), key, {
        contentType: value.type,
        tenantPrefix,
      });
      uploaded[side] = key;
      uploadedKeys.push(key);
    }

    await runAtomicMutations((executor) => {
      const mutations = [
        executor.insert(driverLicences).values({
          id: licenceId,
          driverProfileId: profile.id,
          licenceNumber,
          licenceClass,
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
          verificationStatus,
          isActive: false,
          isVerified: false,
        }),
        executor.insert(auditEvents).values({
          tenantId: auth.session.tenantId,
          tenantSequence: Date.now(),
          eventType: 'driver_licence_uploaded',
          actorUserId: auth.session.user.id,
          actorEmployeeId: id,
          action: 'driver_licence.uploaded',
          entityType: 'driver_licence',
          entityId: licenceId,
          after: {
            version,
            verificationStatus,
            isActive: false,
            previousVerifiedLicencePreserved: true,
            qualityWarnings,
            extractedFields: Object.keys(extracted),
          },
          summary: `Driver licence version ${version} uploaded for employee ${id}`,
          sourceChannel: 'web',
        }),
      ];
      if (codes.length) {
        mutations.push(
          executor.insert(driverLicenceCodes).values(
            codes.map((code) => ({ licenceId, code })),
          ),
        );
      }
      return mutations;
    });
    submissionCommitted = true;

    const [licence] = await db
      .select()
      .from(driverLicences)
      .where(eq(driverLicences.id, licenceId))
      .limit(1);
    if (!licence) throw new Error('Licence submission committed but could not be reloaded');

    await notifyTransportAdmins(auth.session.tenantId, {
      title: 'Driver licence renewal pending review',
      body: `A renewed licence (version ${version}) was submitted for driver ${id.slice(0, 8)} and awaits verification.`,
      entityType: 'driver_licence',
      entityId: licence.id,
      actionUrl: `/dashboard/drivers/licences/${licence.id}`,
    });

    return NextResponse.json(
      { data: licence, extracted, confidence, qualityWarnings, manualEntryRequired: !rawText },
      { status: 201 },
    );
  } catch (error) {
    if (!submissionCommitted && uploadedKeys.length) {
      const cleanup = await Promise.allSettled(uploadedKeys.map((key) => deleteFile(key)));
      if (cleanup.some((result) => result.status === 'rejected')) {
        console.warn('[licences] Failed to clean up one or more uncommitted licence uploads');
      }
    }
    if ((error as { code?: string })?.code === '23505') {
      return NextResponse.json(
        { error: 'A newer licence submission was created at the same time. Refresh and upload again.' },
        { status: 409 },
      );
    }
    console.error('[licences] upload failed:', error);
    return NextResponse.json({ error: 'Licence upload could not be completed.' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const auth = await access(request, id);
    if (!auth.ok) return auth.error;
    const body = (await request.json()) as {
      licenceId?: string;
      action?: 'correct' | 'verify' | 'approve' | 'reject' | 'request_upload';
      corrections?: Record<string, string>;
      reason?: string;
    };
    if (!body.licenceId || !body.action) {
      return NextResponse.json({ error: 'Licence and action are required.' }, { status: 400 });
    }
    if (!['correct', 'verify', 'approve', 'reject', 'request_upload'].includes(body.action)) {
      return NextResponse.json({ error: 'Unsupported licence action' }, { status: 400 });
    }

    const db = getDb();
    const [licence] = await db
      .select()
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverProfiles.id, driverLicences.driverProfileId))
      .where(and(eq(driverLicences.id, body.licenceId), eq(driverProfiles.employeeId, id)))
      .limit(1);
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
    if (TERMINAL_STATUSES.has(current.verificationStatus)) {
      return NextResponse.json(
        { error: `Licence version ${current.version} is ${current.verificationStatus.replaceAll('_', ' ')} and can no longer be changed.` },
        { status: 409 },
      );
    }
    if (!REVIEWABLE_STATUSES.has(current.verificationStatus)) {
      return NextResponse.json(
        { error: `Licence version ${current.version} is not in a reviewable state.` },
        { status: 409 },
      );
    }

    const now = new Date();
    const baseAudit = {
      tenantId: auth.session.tenantId,
      tenantSequence: Date.now(),
      eventType: `driver_licence_${body.action}`,
      actorUserId: auth.session.user.id,
      actorEmployeeId: id,
      action: `driver_licence.${body.action}`,
      entityType: 'driver_licence',
      entityId: current.id,
      before: { verificationStatus: current.verificationStatus, isActive: current.isActive },
      reason: body.reason?.trim() || null,
      sourceChannel: 'web',
    } satisfies typeof auditEvents.$inferInsert;

    if (body.action === 'correct') {
      const corrections = correctionEntries(body.corrections);
      if (!corrections.length || corrections.length !== Object.keys(body.corrections || {}).length) {
        return NextResponse.json({ error: 'No valid corrections supplied' }, { status: 400 });
      }
      const patch = Object.fromEntries(corrections) as Partial<typeof driverLicences.$inferInsert>;
      const nextIssue = String(patch.issueDate ?? current.issueDate);
      const nextExpiry = String(patch.expiryDate ?? current.expiryDate);
      if (!validDateOnly(nextIssue) || !validDateOnly(nextExpiry) || new Date(`${nextExpiry}T23:59:59Z`) < new Date(`${nextIssue}T00:00:00Z`)) {
        return NextResponse.json({ error: 'Corrected licence dates are invalid.' }, { status: 422 });
      }
      await runAtomicMutations((executor) => [
        executor.insert(driverLicenceCorrections).values(
          corrections.map(([fieldName, correctedValue]) => ({
            licenceId: current.id,
            fieldName,
            originalValue: String((current as unknown as Record<string, unknown>)[fieldName] || ''),
            correctedValue,
            correctedByUserId: auth.session.user.id,
            source: 'ocr_review',
          })),
        ),
        executor
          .update(driverLicences)
          .set({ ...patch, verificationStatus: 'awaiting_review', isActive: false, updatedAt: now })
          .where(and(eq(driverLicences.id, current.id), eq(driverLicences.verificationStatus, current.verificationStatus))),
        executor.insert(auditEvents).values({
          ...baseAudit,
          after: Object.fromEntries(corrections),
        }),
      ]);
    } else if (body.action === 'verify' || body.action === 'approve') {
      if (!current.frontImageKey || !current.backImageKey) {
        return NextResponse.json(
          { error: 'Front and back images are required before verification.' },
          { status: 409 },
        );
      }
      const confirmed = body.action === 'approve' ? correctionEntries(body.corrections) : [];
      if (body.corrections && confirmed.length !== Object.keys(body.corrections).length) {
        return NextResponse.json({ error: 'One or more approval corrections are invalid.' }, { status: 422 });
      }
      const patch = Object.fromEntries(confirmed) as Partial<typeof driverLicences.$inferInsert>;
      const approvedIssue = String(patch.issueDate ?? current.issueDate);
      const approvedExpiry = String(patch.expiryDate ?? current.expiryDate);
      if (!validDateOnly(approvedIssue) || !validDateOnly(approvedExpiry) || new Date(`${approvedExpiry}T23:59:59Z`) < new Date(`${approvedIssue}T00:00:00Z`)) {
        return NextResponse.json({ error: 'Licence dates are invalid and cannot be approved.' }, { status: 422 });
      }
      const isCurrent = expiresAfterToday(approvedExpiry, now);
      const [profileState] = await db
        .select({
          driverStatus: driverProfiles.driverStatus,
          availabilityStatus: driverProfiles.availabilityStatus,
        })
        .from(driverProfiles)
        .where(eq(driverProfiles.id, current.driverProfileId))
        .limit(1);
      const wasAwaitingLicence = ['pending_verification', 'incomplete', 'unauthorised'].includes(
        profileState?.driverStatus || '',
      );

      await runAtomicMutations((executor) => {
        const mutations = [];
        if (confirmed.length) {
          mutations.push(
            executor.insert(driverLicenceCorrections).values(
              confirmed.map(([fieldName, correctedValue]) => ({
                licenceId: current.id,
                fieldName,
                originalValue: String((current as unknown as Record<string, unknown>)[fieldName] ?? ''),
                correctedValue: String(correctedValue),
                correctedByUserId: auth.session.user.id,
                source: 'review_approval',
              })),
            ),
          );
        }
        if (isCurrent) {
          mutations.push(
            executor
              .update(driverLicences)
              .set({
                isActive: false,
                verificationStatus: sql`CASE WHEN ${driverLicences.verificationStatus} = 'verified' THEN 'superseded' ELSE ${driverLicences.verificationStatus} END`,
                updatedAt: now,
              })
              .where(
                and(
                  eq(driverLicences.driverProfileId, current.driverProfileId),
                  eq(driverLicences.isActive, true),
                  ne(driverLicences.id, current.id),
                ),
              ),
          );
        }
        mutations.push(
          executor
            .update(driverLicences)
            .set({
              ...patch,
              verificationStatus: isCurrent ? 'verified' : 'expired',
              isActive: isCurrent,
              isVerified: true,
              verifiedByUserId: auth.session.user.id,
              verifiedAt: now,
              rejectionReason: null,
              updatedAt: now,
            })
            .where(and(eq(driverLicences.id, current.id), eq(driverLicences.verificationStatus, current.verificationStatus))),
        );
        if (isCurrent) {
          mutations.push(
            executor
              .update(driverProfiles)
              .set({
                driverStatus: 'authorised',
                availabilityStatus: wasAwaitingLicence
                  ? 'available'
                  : profileState?.availabilityStatus || 'available',
                lastVerifiedAt: now,
                verifiedByUserId: auth.session.user.id,
                updatedAt: now,
              })
              .where(eq(driverProfiles.id, current.driverProfileId)),
          );
        }
        mutations.push(
          executor.insert(auditEvents).values({
            ...baseAudit,
            after: {
              action: body.action,
              corrections: Object.fromEntries(confirmed),
              verificationStatus: isCurrent ? 'verified' : 'expired',
              isActive: isCurrent,
            },
          }),
        );
        return mutations;
      });
    } else {
      if (!body.reason?.trim()) {
        return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
      }
      const verificationStatus = body.action === 'reject' ? 'rejected' : 'needs_correction';
      await runAtomicMutations((executor) => [
        executor
          .update(driverLicences)
          .set({
            verificationStatus,
            isActive: false,
            isVerified: false,
            rejectionReason: body.reason!.trim(),
            updatedAt: now,
          })
          .where(and(eq(driverLicences.id, current.id), eq(driverLicences.verificationStatus, current.verificationStatus))),
        executor.insert(auditEvents).values({
          ...baseAudit,
          after: { verificationStatus, isActive: false },
        }),
      ]);
    }

    const [driverRow] = await db
      .select({
        userId: employees.userId,
        email: employees.email,
        firstName: employees.firstName,
      })
      .from(employees)
      .where(and(eq(employees.id, id), eq(employees.tenantId, auth.session.tenantId)))
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
  } catch (error) {
    console.error('[licences] review failed:', error);
    return NextResponse.json({ error: 'Licence review could not be completed.' }, { status: 500 });
  }
}
