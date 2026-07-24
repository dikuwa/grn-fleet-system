/**
 * Admin Password Reset API
 *
 * POST /api/admin/users/reset-password  — Reset a user's password (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { account } from '@/db/schema/better-auth';
import { tenantMemberships } from '@/db/schema/tenants';
import { userProfiles } from '@/db/schema/auth';
import { auditEvents } from '@/db/schema/audit';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const { userId, forcePasswordChange } = body;

    if (!userId) {
      return NextResponse.json({ error: 'User ID is required' }, { status: 400 });
    }

    const db = getDb();

    // Verify the user is a member of this tenant
    const [membership] = await db
      .select()
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });
    }

    // Generate a secure temporary password
    const tempPassword = crypto.randomUUID()?.replace(/-/g, '').slice(0, 12) || `Fleet${Date.now()}`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    // Update password in account
    await db
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(and(eq(account.userId, userId), eq(account.providerId, 'email')));

    // Check env var for force password change (defaults to disabled)
    const shouldForceChange = forcePasswordChange !== false && process.env.FORCE_PASSWORD_CHANGE_ON_FIRST_LOGIN !== 'false';
    if (shouldForceChange) {
      const [existingProfile] = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);

      if (existingProfile) {
        await db
          .update(userProfiles)
          .set({ requiresPasswordChange: true, updatedAt: new Date() })
          .where(eq(userProfiles.userId, userId));
      } else {
        await db.insert(userProfiles).values({
          id: userId,
          userId,
          requiresPasswordChange: true,
          status: 'active',
        });
      }
    }

    // Log audit event
    try {
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'password_reset_admin',
        actorUserId: session.user.id,
        action: 'reset_password',
        entityType: 'user',
        entityId: userId,
        summary: `Admin reset password for user ${userId}`,
        after: { forcePasswordChange: shouldForceChange },
      });
    } catch {
      // Non-fatal audit error
    }

    return NextResponse.json({
      success: true,
      data: {
        tempPassword,
        message: 'Password has been reset successfully.',
      },
    });
  } catch (error) {
    console.error('[Admin Password Reset] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to reset password: ' + String(error) },
      { status: 500 },
    );
  }
}
