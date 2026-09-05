/**
 * Admin User Restore API
 *
 * POST /api/admin/users/[id]/restore — Re-activate a user whose access was
 * removed via DELETE (status `access_removed`). The staff record is untouched;
 * this only restores the login account within the tenant. Global profile
 * security state is changed only when it was previously marked `removed`.
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

const USER_RESTORE_CONFLICT = 'user_restore_conflict';

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
    const [[membership], [profile]] = await Promise.all([
      db
        .select()
        .from(tenantMemberships)
        .where(
          and(eq(tenantMemberships.userId, id), eq(tenantMemberships.tenantId, session.tenantId)),
        )
        .limit(1),
      db
        .select({ status: userProfiles.status })
        .from(userProfiles)
        .where(eq(userProfiles.userId, id))
        .limit(1),
    ]);

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

    const now = new Date();
    await db.transaction(async (tx) => {
      const [restoredMembership] = await tx
        .update(tenantMemberships)
        .set({ status: 'active' })
        .where(and(
          eq(tenantMemberships.id, membership.id),
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(tenantMemberships.status, 'access_removed'),
        ))
        .returning({ id: tenantMemberships.id });
      if (!restoredMembership) throw new Error(USER_RESTORE_CONFLICT);

      // `user_profiles` is global to the Better Auth user. Only clear a
      // previous tenant-removal marker; never override a deliberate global
      // suspended/disabled security state while restoring one membership.
      if (profile?.status === 'removed') {
        await tx
          .update(userProfiles)
          .set({
            status: 'active',
            accountEnabled: true,
            disabledAt: null,
            updatedAt: now,
          })
          .where(and(eq(userProfiles.userId, id), eq(userProfiles.status, 'removed')));
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'user_access.restored',
        entityType: 'tenant_membership',
        entityId: membership.id,
        summary: 'User access restored. The tenant membership is active again in User Management.',
        after: {
          userId: id,
          restoredAt: now.toISOString(),
          tenantMembershipStatus: 'active',
          globalProfileStatusChanged: profile?.status === 'removed',
          staffRecordPreserved: true,
        },
      }, tx);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Restore] POST failed:', error);
    if (error instanceof Error && error.message === USER_RESTORE_CONFLICT) {
      return NextResponse.json(
        { error: 'This account changed while it was being restored. Refresh User Management and review its current access state.' },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to restore user access' }, { status: 500 });
  }
}
