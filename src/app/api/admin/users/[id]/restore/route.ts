/**
 * Admin User Restore API
 *
 * POST /api/admin/users/[id]/restore — Re-activate a user whose access was
 * removed via DELETE (status `access_removed`). The staff record is untouched;
 * this only restores the login account within the tenant and re-activates the
 * linked user profile so the person appears in User Management again.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenantMemberships } from '@/db/schema/tenants';
import { userProfiles } from '@/db/schema/auth';
import { and, count, eq, inArray } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getTenantEntitlements, checkEntitlement } from '@/lib/entitlements';
import { recordAuditEvent } from '@/lib/audit-event';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });
    }
    if (membership.status !== 'access_removed') {
      return NextResponse.json(
        { error: 'This account has not been removed and does not need restoring.' },
        { status: 409 },
      );
    }

    const entitlements = await getTenantEntitlements(session.tenantId);
    if (entitlements) {
      const [countRow] = await db
        .select({ total: count() })
        .from(tenantMemberships)
        .where(and(
          eq(tenantMemberships.tenantId, session.tenantId),
          inArray(tenantMemberships.status, ['active', 'pending', 'pending_activation', 'suspended']),
        ));
      const userCheck = checkEntitlement(entitlements, 'users', Number(countRow?.total ?? 0), 1);
      if (!userCheck.ok) {
        return NextResponse.json(
          { error: userCheck.message || 'User limit reached. Increase the tenant user allowance before restoring this account.' },
          { status: 409 },
        );
      }
    }

    // These updates are idempotent and both remain tenant/user scoped. The
    // membership state is the authoritative tenant access switch; Staff
    // Management and employee history are deliberately untouched.
    await db
      .update(tenantMemberships)
      .set({ status: 'active' })
      .where(and(eq(tenantMemberships.id, membership.id), eq(tenantMemberships.tenantId, session.tenantId)));
    await db
      .update(userProfiles)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(userProfiles.userId, id));

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'user_access.restored',
      entityType: 'tenant_membership',
      entityId: membership.id,
      summary: 'User access restored. The account is active again in User Management.',
      after: {
        userId: id,
        restoredAt: new Date().toISOString(),
        accountStatus: 'active',
        staffRecordPreserved: true,
      },
    }).catch((auditErr) => {
      console.warn('[Admin User Restore] audit failed:', auditErr);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Restore] POST failed:', error);
    return NextResponse.json({ error: 'Failed to restore user access' }, { status: 500 });
  }
}
