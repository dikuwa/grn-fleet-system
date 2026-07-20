import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { tenantMemberships } from '@/db/schema/tenants';
import { eq, and, desc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { sendReactEmail } from '@/lib/email';
import { UserInviteEmail } from '@/emails/user-invite';
import { createElement } from 'react';

/**
 * GET /api/admin/invites
 *
 * Lists pending user invitations — users created via invite who haven't
 * verified their email yet.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || 'pending'; // pending | all

    // Users whose email is not verified = pending invites
    const whereClause = status === 'pending'
      ? and(eq(user.emailVerified, false))
      : undefined;

    // Fetch pending invites with tenant-scoped join — avoids leaking other tenants' users
    const rows = await db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        tenantStatus: tenantMemberships.status,
        joinedAt: tenantMemberships.joinedAt,
      })
      .from(tenantMemberships)
      .innerJoin(user, eq(tenantMemberships.userId, user.id))
      .where(
        and(
          eq(tenantMemberships.tenantId, session.tenantId),
          eq(user.emailVerified, false),
        ),
      )
      .orderBy(desc(user.createdAt))
      .limit(50);

    const invites = rows.map((row) => ({
      ...row,
      daysSinceInvite: Math.floor(
        (Date.now() - new Date(row.createdAt).getTime()) / (1000 * 60 * 60 * 24),
      ),
    }));

    return NextResponse.json({
      success: true,
      data: {
        invites,
        total: invites.length,
        pending: invites.filter((i) => !i.emailVerified && i.tenantStatus === 'active').length,
      },
    });
  } catch (error) {
    console.error('[Admin Invites] GET failed:', error);
    return NextResponse.json(
      { error: 'Failed to list invites: ' + String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/admin/invites
 *
 * Actions: resend, revoke
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const { action, userId } = body;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    if (!action || !['resend', 'revoke'].includes(action)) {
      return NextResponse.json({ error: 'Action must be resend or revoke' }, { status: 400 });
    }

    const db = getDb();

    // Verify the user exists and belongs to this tenant
    const [membership] = await db
      .select({
        id: tenantMemberships.id,
        status: tenantMemberships.status,
        tenantId: tenantMemberships.tenantId,
      })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.tenantId, session.tenantId),
        ),
      )
      .limit(1);

    if (!membership) {
      return NextResponse.json({ error: 'User not found in your tenant' }, { status: 404 });
    }

    const [targetUser] = await db
      .select()
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);

    if (!targetUser) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (action === 'revoke') {
      // Soft-revoke: suspend the membership
      await db
        .update(tenantMemberships)
        .set({ status: 'suspended' })
        .where(eq(tenantMemberships.id, membership.id));

      return NextResponse.json({
        success: true,
        data: { message: `Invitation for ${targetUser.email} has been revoked.` },
      });
    }

    if (action === 'resend') {
      // Generate a new temporary password
      const tempPassword = crypto.randomUUID?.()?.replace(/-/g, '').slice(0, 12) || `Fleet${Date.now()}`;
      const bcrypt = await import('bcryptjs');
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      // Update password
      const { account } = await import('@/db/schema/better-auth');
      await db
        .update(account)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(eq(account.userId, userId));

      // Re-activate if suspended
      if (membership.status !== 'active') {
        await db
          .update(tenantMemberships)
          .set({ status: 'active' })
          .where(eq(tenantMemberships.id, membership.id));
      }

      // Send the invite email
      const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://grn-fleet-system.vercel.app'}/login`;
      const element = createElement(UserInviteEmail, {
        tenantName: 'GovFleet Namibia',
        recipientName: targetUser.name || targetUser.email.split('@')[0],
        recipientEmail: targetUser.email,
        tempPassword,
        loginUrl,
        invitedByName: session.user.name || 'A system administrator',
      });

      let emailSent = false;
      try {
        const result = await sendReactEmail(
          targetUser.email,
          '🎉 Your Account Has Been Created — GovFleet Namibia',
          element,
        );
        emailSent = result.success;
      } catch (err) {
        console.warn('[Admin Invites] Resend email failed:', err);
      }

      return NextResponse.json({
        success: true,
        data: {
          message: emailSent
            ? `Invitation re-sent to ${targetUser.email}.`
            : `User updated. RESEND_API_KEY not configured — provide password manually: ${tempPassword}`,
          emailSent,
          tempPassword: emailSent ? null : tempPassword,
        },
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    console.error('[Admin Invites] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to process invite action: ' + String(error) },
      { status: 500 },
    );
  }
}
