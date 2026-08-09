/**
 * Driver Licence Review — detail + action
 *
 * GET  /api/drivers/licences/[id]/review — full review payload for the
 *      Transport Officer: licence, employee, profile, previous versions,
 *      corrections, OCR output and signed image URLs.
 *
 * POST /api/drivers/licences/[id]/review — perform a review action
 *      (request_upload / reject) with a reason. Approval uses the existing
 *      PATCH /api/drivers/[id]/licences verify path via the page, which
 *      preserves corrections + audit + notifications consistently.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { auditEvents } from '@/db/schema';
import {
  driverLicenceCodes,
  driverLicenceCorrections,
  driverLicences,
  driverProfiles,
  employees,
  departments,
  offices,
} from '@/db/schema/people';
import { and, desc, eq } from 'drizzle-orm';
import {
  getSessionWorkspace,
  hasPermission,
  requireAnyPermission,
  requirePermission,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { WorkspaceIds } from '@/lib/workspaces';
import { getSignedFileUrl } from '@/lib/storage';
import { createScopedNotifications } from '@/lib/notification-service';
import { runAtomicMutations } from '@/lib/db-atomic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVIEWABLE_STATUSES = new Set(['awaiting_review', 'needs_correction', 'uploaded', 'pending']);

async function canReviewLicence(session: Parameters<typeof getSessionWorkspace>[0]) {
  const workspace = await getSessionWorkspace(session);
  if (workspace.activeWorkspace !== WorkspaceIds.TRANSPORT_ADMIN) return false;
  return hasPermission(session, Permissions.DRIVER_REVIEW_LICENCE);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid licence identifier' }, { status: 400 });
    }
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const permCheck = await requireAnyPermission(auth.session, [
      Permissions.LICENCE_VERIFY,
      Permissions.DRIVER_MANAGE,
      Permissions.DRIVER_REVIEW_LICENCE,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const canReview = await canReviewLicence(auth.session);

    const db = getDb();
    const [licence] = await db
      .select({
        licence: driverLicences,
        employeeId: employees.id,
        employeeNumber: employees.employeeNumber,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employmentStatus: employees.employmentStatus,
        jobTitle: employees.jobTitle,
        departmentName: departments.name,
        officeName: offices.name,
        driverStatus: driverProfiles.driverStatus,
        profileAvailability: driverProfiles.availabilityStatus,
        profileId: driverProfiles.id,
      })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(offices, eq(employees.officeId, offices.id))
      .where(and(eq(driverLicences.id, id), eq(employees.tenantId, auth.session.tenantId)))
      .limit(1);

    if (!licence) {
      return NextResponse.json({ error: 'Licence record not found' }, { status: 404 });
    }

    const profileId = licence.profileId;
    const [frontUrl, backUrl, pdfUrl] = await Promise.all([
      licence.licence.frontImageKey
        ? getSignedFileUrl(licence.licence.frontImageKey, 3600).catch(() => null)
        : null,
      licence.licence.backImageKey
        ? getSignedFileUrl(licence.licence.backImageKey, 3600).catch(() => null)
        : null,
      licence.licence.sourcePdfKey
        ? getSignedFileUrl(licence.licence.sourcePdfKey, 3600).catch(() => null)
        : null,
    ]);

    const [codes, corrections, previous, allVersions] = await Promise.all([
      db.select({ code: driverLicenceCodes.code }).from(driverLicenceCodes).where(eq(driverLicenceCodes.licenceId, id)),
      db.select().from(driverLicenceCorrections).where(eq(driverLicenceCorrections.licenceId, id)).orderBy(desc(driverLicenceCorrections.createdAt)),
      db
        .select()
        .from(driverLicences)
        .where(
          and(
            eq(driverLicences.driverProfileId, profileId),
            eq(driverLicences.isActive, true),
            eq(driverLicences.isVerified, true),
          ),
        )
        .orderBy(desc(driverLicences.version))
        .limit(1),
      db
        .select({
          id: driverLicences.id,
          version: driverLicences.version,
          verificationStatus: driverLicences.verificationStatus,
          isActive: driverLicences.isActive,
          licenceClass: driverLicences.licenceClass,
          expiryDate: driverLicences.expiryDate,
          createdAt: driverLicences.createdAt,
        })
        .from(driverLicences)
        .where(eq(driverLicences.driverProfileId, profileId))
        .orderBy(desc(driverLicences.version)),
    ]);

    const currentVerified = previous[0] ?? null;
    const currentVerifiedUrl = currentVerified?.frontImageKey
      ? await getSignedFileUrl(currentVerified.frontImageKey, 3600).catch(() => null)
      : null;

    const rawOcr = (licence.licence.rawOcrResult ?? {}) as {
      text?: string;
      extracted?: Record<string, string | string[] | null>;
      qualityWarnings?: string[];
    };

    const warnings: string[] = [];
    if (rawOcr.qualityWarnings?.length) warnings.push(...rawOcr.qualityWarnings);
    if (currentVerified && currentVerified.id !== licence.licence.id) {
      if (
        licence.licence.licenceNumber !== currentVerified.licenceNumber &&
        !licence.licence.licenceNumber.startsWith('PENDING-')
      ) {
        warnings.push('licence_number_mismatch');
      }
      if (
        licence.licence.licenceClass !== currentVerified.licenceClass &&
        !licence.licence.licenceClass.startsWith('PENDING')
      ) {
        warnings.push('licence_class_changed');
      }
    }
    if (new Date(`${licence.licence.issueDate}T00:00:00Z`) > new Date()) {
      warnings.push('issue_date_in_future');
    }
    if (new Date(`${licence.licence.expiryDate}T23:59:59Z`) < new Date()) {
      warnings.push('expiry_date_passed');
    }

    return NextResponse.json({
      success: true,
      data: {
        canReview,
        reviewable: REVIEWABLE_STATUSES.has(licence.licence.verificationStatus),
        licence: {
          ...licence.licence,
          ocrText: rawOcr.text ?? null,
          extracted: rawOcr.extracted ?? null,
        },
        codes: codes.map((row) => row.code),
        corrections,
        driver: {
          employeeId: licence.employeeId,
          employeeNumber: licence.employeeNumber,
          name: `${licence.firstName} ${licence.lastName}`,
          jobTitle: licence.jobTitle,
          departmentName: licence.departmentName,
          officeName: licence.officeName,
          employmentStatus: licence.employmentStatus,
          driverStatus: licence.driverStatus,
          availabilityStatus: licence.profileAvailability,
        },
        currentVerified: currentVerified
          ? {
              ...currentVerified,
              frontUrl: currentVerifiedUrl,
            }
          : null,
        previousVersions: allVersions,
        files: { frontUrl, backUrl, pdfUrl },
        warnings,
      },
    });
  } catch (error) {
    console.error('[drivers/licences/review] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load licence review' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid licence identifier' }, { status: 400 });
    }
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;

    const workspace = await getSessionWorkspace(auth.session);
    if (workspace.activeWorkspace !== WorkspaceIds.TRANSPORT_ADMIN) {
      return NextResponse.json(
        { error: 'Licence review decisions are available only in the Transport Administration workspace.' },
        { status: 403 },
      );
    }
    const permCheck = await requirePermission(auth.session, Permissions.DRIVER_REVIEW_LICENCE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = (await request.json()) as {
      action: 'request_upload' | 'reject';
      reason?: string;
    };
    if (!['request_upload', 'reject'].includes(body.action)) {
      return NextResponse.json({ error: 'Unsupported review action' }, { status: 400 });
    }
    const reason = body.reason?.trim();
    if (!reason) {
      return NextResponse.json({ error: 'A reason is required' }, { status: 400 });
    }

    const db = getDb();
    const [licence] = await db
      .select({
        id: driverLicences.id,
        licenceNumber: driverLicences.licenceNumber,
        licenceClass: driverLicences.licenceClass,
        verificationStatus: driverLicences.verificationStatus,
        driverProfileId: driverLicences.driverProfileId,
      })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .where(and(eq(driverLicences.id, id), eq(employees.tenantId, auth.session.tenantId)))
      .limit(1);

    if (!licence) {
      return NextResponse.json({ error: 'Licence record not found' }, { status: 404 });
    }
    if (!REVIEWABLE_STATUSES.has(licence.verificationStatus)) {
      return NextResponse.json(
        { error: `This licence is ${licence.verificationStatus.replaceAll('_', ' ')} and can no longer receive a review decision.` },
        { status: 409 },
      );
    }

    const newStatus = body.action === 'reject' ? 'rejected' : 'needs_correction';
    const now = new Date();
    await runAtomicMutations((executor) => [
      executor
        .update(driverLicences)
        .set({
          verificationStatus: newStatus,
          isActive: false,
          isVerified: false,
          rejectionReason: reason,
          updatedAt: now,
        })
        .where(
          and(
            eq(driverLicences.id, licence.id),
            eq(driverLicences.verificationStatus, licence.verificationStatus),
          ),
        ),
      executor.insert(auditEvents).values({
        tenantId: auth.session.tenantId,
        tenantSequence: Date.now(),
        eventType: `driver_licence_${body.action}`,
        actorUserId: auth.session.user.id,
        action: `driver_licence.${body.action}`,
        entityType: 'driver_licence',
        entityId: licence.id,
        before: { verificationStatus: licence.verificationStatus },
        after: { verificationStatus: newStatus, isActive: false, isVerified: false },
        reason,
        summary: `Driver licence ${body.action === 'reject' ? 'rejected' : 'changes requested'} (${licence.licenceClass})`,
        sourceChannel: 'web',
      }),
    ]);

    const [updated] = await db
      .select({ verificationStatus: driverLicences.verificationStatus })
      .from(driverLicences)
      .where(eq(driverLicences.id, licence.id))
      .limit(1);
    if (updated?.verificationStatus !== newStatus) {
      return NextResponse.json(
        { error: 'This licence changed while the review decision was being saved. Refresh and try again.' },
        { status: 409 },
      );
    }

    const [driver] = await db
      .select({ userId: employees.userId, email: employees.email, firstName: employees.firstName, lastName: employees.lastName })
      .from(driverProfiles)
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .where(
        and(
          eq(driverProfiles.id, licence.driverProfileId),
          eq(employees.tenantId, auth.session.tenantId),
        ),
      )
      .limit(1);

    if (driver?.userId || driver?.email) {
      try {
        if (driver.userId) {
          await createScopedNotifications({
            tenantId: auth.session.tenantId,
            recipientUserIds: [driver.userId],
            category: 'outcome',
            eventType: 'driver_licence_review',
            title: body.action === 'reject' ? 'Your licence renewal was rejected' : 'Action needed on your licence',
            body: body.action === 'reject'
              ? `Licence ${licence.licenceClass} was rejected: ${reason}`
              : `Your licence submission needs changes: ${reason}`,
            entityType: 'driver_licence',
            entityId: licence.id,
            actionUrl: '/dashboard/driver-self-service',
            workspace: WorkspaceIds.DRIVER,
          });
        }
        if (driver.email) {
          const { sendNotificationEmail } = await import('@/lib/email');
          await sendNotificationEmail({
            to: driver.email,
            type: 'licence_review',
            title: body.action === 'reject' ? 'Your licence renewal was rejected' : 'Action needed on your licence',
            body: body.action === 'reject'
              ? `Licence ${licence.licenceClass} was rejected: ${reason}`
              : `Your licence submission needs changes: ${reason}`,
            actionUrl: '/dashboard/driver-self-service',
            recipientName: driver.firstName || 'Driver',
          });
        }
      } catch (error) {
        console.warn('[licences/review] driver notification failed:', error);
      }
    }

    return NextResponse.json({ success: true, data: { id: licence.id, verificationStatus: newStatus } });
  } catch (error) {
    console.error('[drivers/licences/review] POST failed:', error);
    return NextResponse.json({ error: 'Failed to update licence review' }, { status: 500 });
  }
}