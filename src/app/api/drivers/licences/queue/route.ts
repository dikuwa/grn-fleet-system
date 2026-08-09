/**
 * Driver Licence Verification Queue
 *
 * GET /api/drivers/licences/queue?status=&q=&class=&from=&to=&page=&limit=
 *
 * Lists every tenant driver licence (and pending renewal submissions) so
 * Transport Administration can action renewals. Every row includes the
 * human-readable review verdict (pending / expiring / expired / verified /
 * rejected / changes_requested) computed server-side.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees, departments, offices, driverProfiles, driverLicences } from '@/db/schema/people';
import { and, desc, eq, gte, ilike, lte, or } from 'drizzle-orm';
import { requireAnyPermission, requireDashboardAction, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

const REVIEW_PENDING = ['uploaded', 'awaiting_review', 'needs_correction', 'pending'] as const;

type StatusFilter =
  | 'all'
  | 'pending'
  | 'expiring'
  | 'expired'
  | 'changes_requested'
  | 'rejected'
  | 'approved';

const VALID_STATUSES = new Set<StatusFilter>([
  'all',
  'pending',
  'expiring',
  'expired',
  'changes_requested',
  'rejected',
  'approved',
]);

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    // Keep direct API access aligned with the dashboard registry. Transport
    // Administration may manage the queue and Tenant Administration may read it;
    // an unrelated workspace must not gain licence visibility merely because it
    // happens to hold STAFF_VIEW.
    const routeCheck = await requireDashboardAction(
      session,
      '/dashboard/drivers/licences',
      'view',
    );
    if (routeCheck instanceof NextResponse) return routeCheck;

    const permCheck = await requireAnyPermission(session, [
      Permissions.LICENCE_VERIFY,
      Permissions.DRIVER_MANAGE,
      Permissions.STAFF_VIEW,
    ]);
    if (permCheck instanceof NextResponse) return permCheck;

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status')?.trim() || 'pending';
    const status = VALID_STATUSES.has(statusParam as StatusFilter)
      ? (statusParam as StatusFilter)
      : 'pending';
    const q = searchParams.get('q')?.trim() || '';
    const licenceClass = searchParams.get('class')?.trim() || '';
    const from = searchParams.get('from')?.trim() || '';
    const to = searchParams.get('to')?.trim() || '';
    const page = Math.max(1, Number(searchParams.get('page') || '1') || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit') || '15') || 15));

    const db = getDb();
    const tenantId = session.tenantId;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sixtyDaysFromNow = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);

    const conditions = [eq(employees.tenantId, tenantId)];

    if (q) {
      conditions.push(
        or(
          ilike(employees.firstName, `%${q}%`),
          ilike(employees.lastName, `%${q}%`),
          ilike(employees.employeeNumber, `%${q}%`),
          ilike(driverLicences.licenceNumber, `%${q}%`),
          ilike(driverLicences.licenceClass, `%${q}%`),
        )!,
      );
    }
    if (licenceClass) {
      conditions.push(ilike(driverLicences.licenceClass, `%${licenceClass}%`));
    }
    if (from) conditions.push(gte(driverLicences.expiryDate, from));
    if (to) conditions.push(lte(driverLicences.expiryDate, to));

    const base = db
      .select({
        licenceId: driverLicences.id,
        version: driverLicences.version,
        isActive: driverLicences.isActive,
        licenceNumber: driverLicences.licenceNumber,
        licenceClass: driverLicences.licenceClass,
        issueDate: driverLicences.issueDate,
        expiryDate: driverLicences.expiryDate,
        verificationStatus: driverLicences.verificationStatus,
        ocrConfidence: driverLicences.ocrConfidence,
        rawOcrResult: driverLicences.rawOcrResult,
        createdAt: driverLicences.createdAt,
        employeeId: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        employeeNumber: employees.employeeNumber,
        jobTitle: employees.jobTitle,
        departmentName: departments.name,
        officeName: offices.name,
        driverStatus: driverProfiles.driverStatus,
      })
      .from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(offices, eq(employees.officeId, offices.id))
      .where(and(...conditions));

    // Fetch all matching rows (the queue is bounded by driver licences, not
    // employees — acceptable to page in SQL for correctness, but we need the
    // status computation first, so pull the matching set and filter in JS).
    const rows = await base.orderBy(desc(driverLicences.createdAt));

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const enriched = rows.map((row) => {
      const expiry = new Date(`${row.expiryDate}T23:59:59.999Z`).getTime();
      const daysUntil = Math.ceil((expiry - now) / dayMs);
      const statusVerified = row.verificationStatus === 'verified';
      const statusExpired = row.verificationStatus === 'expired' || (statusVerified && daysUntil < 0);
      const statusPending =
        (REVIEW_PENDING as readonly string[]).includes(row.verificationStatus) ||
        row.verificationStatus === 'needs_correction';

      let reviewStatus: string;
      if (row.verificationStatus === 'rejected') reviewStatus = 'rejected';
      else if (row.verificationStatus === 'needs_correction') reviewStatus = 'changes_requested';
      else if (statusExpired) reviewStatus = 'expired';
      else if (statusVerified && daysUntil <= 60) reviewStatus = 'expiring';
      else if (statusVerified) reviewStatus = 'approved';
      else if (statusPending) reviewStatus = 'pending';
      else reviewStatus = row.verificationStatus;

      // Warnings derived from stored OCR output (never trusted as final).
      const raw = (row.rawOcrResult ?? {}) as { qualityWarnings?: string[] };
      const qualityWarnings = raw.qualityWarnings ?? [];
      const ocrConfidenceAvg = row.ocrConfidence
        ? Object.values(row.ocrConfidence).filter((v): v is number => typeof v === 'number')
        : [];
      const confidence = ocrConfidenceAvg.length
        ? Math.round(ocrConfidenceAvg.reduce((sum, value) => sum + value, 0) / ocrConfidenceAvg.length)
        : null;

      return {
        licenceId: row.licenceId,
        version: row.version,
        isActive: row.isActive,
        licenceNumber: row.licenceNumber,
        licenceClass: row.licenceClass,
        issueDate: row.issueDate,
        expiryDate: row.expiryDate,
        verificationStatus: row.verificationStatus,
        reviewStatus,
        daysUntil,
        confidence,
        qualityWarnings,
        createdAt: row.createdAt.toISOString(),
        employeeId: row.employeeId,
        driverName: `${row.firstName} ${row.lastName}`,
        employeeNumber: row.employeeNumber,
        jobTitle: row.jobTitle,
        departmentName: row.departmentName,
        officeName: row.officeName,
        driverStatus: row.driverStatus,
      };
    });

    const filtered = enriched.filter((row) => {
      if (status === 'all') return true;
      return row.reviewStatus === status;
    });

    const total = filtered.length;
    const pageRows = filtered.slice((page - 1) * limit, (page - 1) * limit + limit);

    // Server-side summary stats for the queue header.
    const stats = {
      pending: enriched.filter((row) => row.reviewStatus === 'pending').length,
      expiring: enriched.filter((row) => row.reviewStatus === 'expiring').length,
      expired: enriched.filter((row) => row.reviewStatus === 'expired').length,
      changes_requested: enriched.filter((row) => row.reviewStatus === 'changes_requested').length,
      rejected: enriched.filter((row) => row.reviewStatus === 'rejected').length,
      approved: enriched.filter((row) => row.reviewStatus === 'approved').length,
      total: enriched.length,
      asOf: new Date().toISOString(),
    };

    return NextResponse.json({
      success: true,
      data: pageRows,
      stats,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      today: today.toISOString(),
      sixtyDaysFromNow: sixtyDaysFromNow.toISOString(),
    });
  } catch (error) {
    console.error('[drivers/licences/queue] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load licence verification queue' }, { status: 500 });
  }
}
