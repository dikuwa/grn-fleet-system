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
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';
import bcrypt from 'bcryptjs';

const PASSWORD_RESET_CONFLICT = 'password_reset_conflict';

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

    // Verify the user is a member of this tenant before doing expensive password work.
    const [membership] = await db
      .select({ id: tenantMemberships.id })
      .from(tenantMemberships)
      .where(
        and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.tenantId, session.tenantId)),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'User not found in your organisation' }, { status: 404 });
    }

    const [credential] = await db
      .select({ id: account.id, password: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'email')))
      .limit(1);
    if (!credential?.password) {
      return NextResponse.json(
        { error: 'This user has no email password credential to reset.' },
        { status: 409 },
      );
    }
    const previousPasswordHash = credential.password;

    // Generate a secure temporary password. It is returned only after the exact
    // credential hash reviewed above is successfully claimed in the transaction.
    const tempPassword = crypto.randomUUID()?.replace(/-/g, '').slice(0, 12) || `Fleet${Date.now()}`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);
    const shouldForceChange =
      forcePasswordChange !== false &&
      process.env.FORCE_PASSWORD_CHANGE_ON_FIRST_LOGIN !== 'false';

    await db.transaction(async (tx) => {
      // Revalidate tenant membership under a row lock so a removal/tenant change
      // cannot race the credential mutation after the initial membership read.
      const [lockedMembership] = await tx
        .select({ id: tenantMemberships.id })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.id, membership.id),
            eq(tenantMemberships.userId, userId),
            eq(tenantMemberships.tenantId, session.tenantId),
          ),
        )
        .limit(1)
        .for('update');
      if (!lockedMembership) throw new Error(PASSWORD_RESET_CONFLICT);

      const [rotatedCredential] = await tx
        .update(account)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(
          and(
            eq(account.id, credential.id),
            eq(account.userId, userId),
            eq(account.providerId, 'email'),
            eq(account.password, previousPasswordHash),
          ),
        )
        .returning({ id: account.id });
      if (!rotatedCredential) throw new Error(PASSWORD_RESET_CONFLICT);

      if (shouldForceChange) {
        const [existingProfile] = await tx
          .select({ id: userProfiles.id })
          .from(userProfiles)
          .where(eq(userProfiles.userId, userId))
          .limit(1);

        if (existingProfile) {
          await tx
            .update(userProfiles)
            .set({ requiresPasswordChange: true, updatedAt: new Date() })
            .where(eq(userProfiles.userId, userId));
        } else {
          await tx.insert(userProfiles).values({
            id: userId,
            userId,
            requiresPasswordChange: true,
            status: 'active',
          });
        }
      }

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        eventType: 'password_reset_admin',
        action: 'reset_password',
        entityType: 'user',
        entityId: userId,
        summary: `Admin reset password for user ${userId}`,
        after: { forcePasswordChange: shouldForceChange },
      }, tx);
    });

    return NextResponse.json({
      success: true,
      data: {
        tempPassword,
        message: 'Password has been reset successfully.',
      },
    });
  } catch (error) {
    console.error('[Admin Password Reset] POST failed:', error);
    if (error instanceof Error && error.message === PASSWORD_RESET_CONFLICT) {
      return NextResponse.json(
        {
          error:
            'This account or credential changed while the reset was being processed. Refresh User Management before issuing another temporary password.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: 'Failed to reset password: ' + String(error) },
      { status: 500 },
    );
  }
}
