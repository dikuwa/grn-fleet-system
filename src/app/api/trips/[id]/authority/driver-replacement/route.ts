import { and, desc, eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { employees } from '@/db/schema/people';
import { tripAmendments, tripAuthorities } from '@/db/schema/trips';
import {
  requireAnyPermission,
  requireDashboardAction,
  requireRequestAuth,
} from '@/lib/auth-helpers';
import { decidePostAuthorisationDriverReplacement } from '@/lib/driver-authority-replacement';
import { Permissions } from '@/lib/permissions';

const AUTHORISER_PERMISSIONS = [
  Permissions.TRIP_AUTHORIZE_REGIONAL,
  Permissions.TRIP_AUTHORIZE_NATIONAL,
] as const;

async function requireDriverReplacementAuthoriser(
  request: NextRequest,
): Promise<{ ok: true; session: Awaited<ReturnType<typeof requireRequestAuth>> extends infer T ? T extends { ok: true; session: infer S } ? S : never : never } | { ok: false; error: NextResponse }> {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const { session } = auth;

  const routeCheck = await requireDashboardAction(session, '/dashboard/approvals', 'approve');
  if (routeCheck instanceof NextResponse) return { ok: false, error: routeCheck };

  const permission = await requireAnyPermission(session, [...AUTHORISER_PERMISSIONS]);
  if (permission instanceof NextResponse) return { ok: false, error: permission };

  return { ok: true, session };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireDriverReplacementAuthoriser(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const { id: tripId } = await params;
    const db = getDb();

    const [pending] = await db
      .select({
        id: tripAmendments.id,
        reason: tripAmendments.reason,
        version: tripAmendments.version,
        createdAt: tripAmendments.createdAt,
        newValue: tripAmendments.newValue,
      })
      .from(tripAmendments)
      .innerJoin(tripAuthorities, eq(tripAuthorities.id, tripAmendments.authorityId))
      .where(
        and(
          eq(tripAuthorities.tripId, tripId),
          eq(tripAuthorities.tenantId, session.tenantId),
          eq(tripAmendments.amendmentType, 'driver_replacement'),
          eq(tripAmendments.status, 'pending'),
        ),
      )
      .orderBy(desc(tripAmendments.createdAt))
      .limit(1);

    if (!pending) return NextResponse.json({ pending: false, amendment: null });

    const replacementDriverEmployeeId =
      typeof pending.newValue?.driverEmployeeId === 'string'
        ? pending.newValue.driverEmployeeId
        : null;
    let replacementDriver: { id: string; name: string; employeeNumber: string } | null = null;
    if (replacementDriverEmployeeId) {
      const [driver] = await db
        .select({
          id: employees.id,
          firstName: employees.firstName,
          lastName: employees.lastName,
          employeeNumber: employees.employeeNumber,
        })
        .from(employees)
        .where(
          and(
            eq(employees.id, replacementDriverEmployeeId),
            eq(employees.tenantId, session.tenantId),
          ),
        )
        .limit(1);
      if (driver) {
        replacementDriver = {
          id: driver.id,
          name: `${driver.firstName} ${driver.lastName}`.trim(),
          employeeNumber: driver.employeeNumber,
        };
      }
    }

    return NextResponse.json({
      pending: true,
      amendment: {
        id: pending.id,
        reason: pending.reason,
        version: pending.version,
        createdAt: pending.createdAt.toISOString(),
        replacementDriver,
      },
    });
  } catch (error) {
    console.error('[authority/driver-replacement] GET failed:', error);
    return NextResponse.json(
      { error: 'The pending driver replacement could not be loaded.' },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireDriverReplacementAuthoriser(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      amendmentId?: string;
      action?: 'approve' | 'reject';
      comment?: string;
    };
    if (!body.amendmentId || !['approve', 'reject'].includes(body.action || '')) {
      return NextResponse.json(
        { error: 'Driver replacement amendment and decision are required.' },
        { status: 422 },
      );
    }
    const comment = body.comment?.trim() || '';
    if (comment.length > 1000) {
      return NextResponse.json({ error: 'Decision comment must be 1000 characters or fewer.' }, { status: 422 });
    }

    return decidePostAuthorisationDriverReplacement({
      tripId: id,
      amendmentId: body.amendmentId,
      action: body.action!,
      comment: comment || undefined,
      session,
    });
  } catch (error) {
    console.error('[authority/driver-replacement] PATCH failed:', error);
    return NextResponse.json(
      { error: 'The driver replacement decision could not be saved. Refresh and try again.' },
      { status: 500 },
    );
  }
}
