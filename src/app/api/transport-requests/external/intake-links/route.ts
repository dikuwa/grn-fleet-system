import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { getDb } from '@/db';
import { employees, requestIntakeLinks, workflowDefinitions } from '@/db/schema';
import { requireDashboardAction, requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { secureHash } from '@/lib/secure-request';
import { recordAuditEvent } from '@/lib/audit-event';
import { env } from '@/env';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function authorize(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const routeCheck = await requireDashboardAction(auth.session, '/dashboard/requests/new', 'create');
  if (routeCheck instanceof NextResponse) return { ok: false as const, error: routeCheck };
  const permissionCheck = await requirePermission(auth.session, Permissions.SECURE_REQUEST_ASSIST);
  if (permissionCheck instanceof NextResponse) return { ok: false as const, error: permissionCheck };
  return { ok: true as const, session: auth.session };
}

export async function GET(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.error;
    const db = getDb();
    const links = await db
      .select({
        id: requestIntakeLinks.id,
        label: requestIntakeLinks.label,
        sponsorEmployeeId: requestIntakeLinks.sponsorEmployeeId,
        sponsorFirstName: employees.firstName,
        sponsorLastName: employees.lastName,
        tripScope: requestIntakeLinks.tripScope,
        expiresAt: requestIntakeLinks.expiresAt,
        maxSubmissions: requestIntakeLinks.maxSubmissions,
        submissionCount: requestIntakeLinks.submissionCount,
        lastSubmittedAt: requestIntakeLinks.lastSubmittedAt,
        revokedAt: requestIntakeLinks.revokedAt,
        createdAt: requestIntakeLinks.createdAt,
        isExpired: sql<boolean>`${requestIntakeLinks.expiresAt} < now()`,
      })
      .from(requestIntakeLinks)
      .innerJoin(
        employees,
        and(
          eq(employees.id, requestIntakeLinks.sponsorEmployeeId),
          eq(employees.tenantId, auth.session.tenantId),
        ),
      )
      .where(eq(requestIntakeLinks.tenantId, auth.session.tenantId))
      .orderBy(desc(requestIntakeLinks.createdAt))
      .limit(100);

    return NextResponse.json({ success: true, data: links }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    console.error('[external-intake-links] GET failed:', error);
    return NextResponse.json({ error: 'External intake links could not be loaded' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.error;
    const body = (await request.json().catch(() => ({}))) as {
      sponsorEmployeeId?: string;
      tripScope?: 'regional' | 'national';
      expiresInHours?: number;
      maxSubmissions?: number;
      label?: string;
    };
    const sponsorEmployeeId = String(body.sponsorEmployeeId || '').trim();
    if (!UUID_PATTERN.test(sponsorEmployeeId)) {
      return NextResponse.json({ error: 'Choose a valid internal sponsor employee' }, { status: 422 });
    }
    const tripScope = body.tripScope === 'national' ? 'national' : 'regional';
    const expiresInHours = Number(body.expiresInHours ?? 168);
    if (!Number.isFinite(expiresInHours) || expiresInHours < 1 || expiresInHours > 2160) {
      return NextResponse.json({ error: 'Expiry must be between 1 hour and 90 days' }, { status: 422 });
    }
    const maxSubmissions = Number(body.maxSubmissions ?? 1);
    if (!Number.isInteger(maxSubmissions) || maxSubmissions < 1 || maxSubmissions > 1000) {
      return NextResponse.json({ error: 'Submission limit must be between 1 and 1000' }, { status: 422 });
    }
    const label = String(body.label || '').trim().slice(0, 160) || null;
    const db = getDb();
    const [sponsor] = await db
      .select({
        id: employees.id,
        firstName: employees.firstName,
        lastName: employees.lastName,
        departmentId: employees.departmentId,
        officeId: employees.officeId,
        regionId: employees.regionId,
      })
      .from(employees)
      .where(
        and(
          eq(employees.id, sponsorEmployeeId),
          eq(employees.tenantId, auth.session.tenantId),
          eq(employees.employmentStatus, 'active'),
        ),
      )
      .limit(1);
    if (!sponsor) {
      return NextResponse.json({ error: 'The selected sponsor is not an active employee in this tenant' }, { status: 404 });
    }

    const routes = await db
      .select({
        id: workflowDefinitions.id,
        regionId: workflowDefinitions.regionId,
        officeId: workflowDefinitions.officeId,
        departmentId: workflowDefinitions.departmentId,
      })
      .from(workflowDefinitions)
      .where(
        and(
          eq(workflowDefinitions.tenantId, auth.session.tenantId),
          eq(workflowDefinitions.tripScope, tripScope),
          eq(workflowDefinitions.isActive, true),
        ),
      );
    const hasMatchingRoute = routes.some(
      (route) =>
        (!route.regionId || route.regionId === sponsor.regionId) &&
        (!route.officeId || route.officeId === sponsor.officeId) &&
        (!route.departmentId || route.departmentId === sponsor.departmentId),
    );
    if (!hasMatchingRoute) {
      return NextResponse.json(
        { error: 'No active approval route matches this sponsor and trip scope' },
        { status: 409 },
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + Math.round(expiresInHours) * 60 * 60 * 1000);
    const [created] = await db
      .insert(requestIntakeLinks)
      .values({
        tenantId: auth.session.tenantId,
        sponsorEmployeeId: sponsor.id,
        tokenHash: secureHash(token),
        label,
        tripScope,
        expiresAt,
        maxSubmissions,
        createdByUserId: auth.session.user.id,
      })
      .returning({
        id: requestIntakeLinks.id,
        label: requestIntakeLinks.label,
        tripScope: requestIntakeLinks.tripScope,
        expiresAt: requestIntakeLinks.expiresAt,
        maxSubmissions: requestIntakeLinks.maxSubmissions,
        createdAt: requestIntakeLinks.createdAt,
      });

    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'external_intake_link.created',
      entityType: 'request_intake_link',
      entityId: created.id,
      sourceChannel: 'dashboard',
      after: {
        sponsorEmployeeId: sponsor.id,
        tripScope,
        expiresAt: expiresAt.toISOString(),
        maxSubmissions,
      },
      summary: `External request intake link created for sponsor ${sponsor.firstName} ${sponsor.lastName}`,
    }).catch(() => undefined);

    const baseUrl = env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    return NextResponse.json(
      {
        success: true,
        data: {
          ...created,
          sponsor: { id: sponsor.id, firstName: sponsor.firstName, lastName: sponsor.lastName },
          intakeUrl: `${baseUrl}/request/external/${encodeURIComponent(token)}`,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    console.error('[external-intake-links] POST failed:', error);
    return NextResponse.json({ error: 'External intake link could not be created' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await authorize(request);
    if (!auth.ok) return auth.error;
    const id = request.nextUrl.searchParams.get('id')?.trim() || '';
    if (!UUID_PATTERN.test(id)) {
      return NextResponse.json({ error: 'Invalid intake-link identifier' }, { status: 422 });
    }
    const db = getDb();
    const [revoked] = await db
      .update(requestIntakeLinks)
      .set({ revokedAt: new Date(), revokedByUserId: auth.session.user.id })
      .where(
        and(
          eq(requestIntakeLinks.id, id),
          eq(requestIntakeLinks.tenantId, auth.session.tenantId),
          sql`${requestIntakeLinks.revokedAt} is null`,
        ),
      )
      .returning({ id: requestIntakeLinks.id, sponsorEmployeeId: requestIntakeLinks.sponsorEmployeeId });
    if (!revoked) return NextResponse.json({ error: 'Active intake link not found' }, { status: 404 });

    await recordAuditEvent({
      tenantId: auth.session.tenantId,
      actorUserId: auth.session.user.id,
      action: 'external_intake_link.revoked',
      entityType: 'request_intake_link',
      entityId: revoked.id,
      sourceChannel: 'dashboard',
      before: { revokedAt: null },
      after: { revokedAt: new Date().toISOString() },
      summary: 'External request intake link revoked',
    }).catch(() => undefined);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[external-intake-links] DELETE failed:', error);
    return NextResponse.json({ error: 'External intake link could not be revoked' }, { status: 500 });
  }
}
