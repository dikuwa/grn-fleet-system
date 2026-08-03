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
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
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

    // Verify the user is (or was) a member of this tenant (cross-tenant protection)
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

    await db.transaction(async (tx) => {
      await tx
        .update(tenantMemberships)
        .set({ status: 'active' })
        .where(eq(tenantMemberships.id, membership.id));
      await tx
        .update(userProfiles)
        .set({ status: 'active', updatedAt: new Date() })
        .where(eq(userProfiles.userId, id));
    });

    try {
      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'user_access.restored',
        entityType: 'tenant_membership',
        entityId: membership.id,
        summary: `User access restored. The account is active again in User Management.`,
        after: {
          userId: id,
          restoredAt: new Date().toISOString(),
          accountStatus: 'active',
          staffRecordPreserved: true,
        },
      });
    } catch (auditErr) {
      console.warn('[Admin User Restore] audit failed:', auditErr);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Admin User Restore] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to restore user: ' + String(error) },
      { status: 500 },
    );
  }
}
