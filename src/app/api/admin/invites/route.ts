import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { account, user } from '@/db/schema/better-auth';
import { tenantMemberships, tenants } from '@/db/schema/tenants';
import { eq, and, desc } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { sendReactEmail } from '@/lib/email';
import { UserInviteEmail } from '@/emails/user-invite';
import { recordAuditEvent } from '@/lib/audit-event';
import { createElement } from 'react';
import bcrypt from 'bcryptjs';

const INVITATION_STATE_CONFLICT = 'invitation_state_conflict';
const INVITATION_CREDENTIAL_CONFLICT = 'invitation_credential_conflict';

/**
 * GET /api/admin/invites
 *
 * Lists tenant account invitations only. Pending invitations are unverified
 * accounts with an active tenant membership. The `all` view includes revoked
 * or otherwise non-active invitation records, but never activated users.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const status = req.nextUrl.searchParams.get('status') || 'pending';
    if (!['pending', 'all'].includes(status)) {
      return NextResponse.json({ error: 'Unsupported invitation status filter' }, { status: 400 });
    }

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
        status === 'pending'
          ? and(
              eq(tenantMemberships.tenantId, session.tenantId),
              eq(tenantMemberships.status, 'active'),
              eq(user.emailVerified, false),
            )
          : and(
              eq(tenantMemberships.tenantId, session.tenantId),
              eq(user.emailVerified, false),
            ),
      )
      .orderBy(desc(user.createdAt))
      .limit(100);

    const invites = rows.map((row) => ({
      ...row,
      daysSinceInvite: Math.max(
        0,
        Math.floor((Date.now() - new Date(row.createdAt).getTime()) / (1000 * 60 * 60 * 24)),
      ),
    }));

    return NextResponse.json({
      success: true,
      data: {
        invites,
        total: invites.length,
        pending: invites.filter(
          (invite) => !invite.emailVerified && invite.tenantStatus === 'active',
        ).length,
      },
    });
  } catch (error) {
    console.error('[Admin Invites] GET failed:', error);
    return NextResponse.json({ error: 'Failed to list invitations' }, { status: 500 });
  }
}

/**
 * POST /api/admin/invites
 *
 * Actions: resend | revoke
 *
 * These actions are intentionally limited to unverified invitation accounts.
 * Established users must be suspended/restored from User Management instead;
 * this endpoint must never reset their password or reactivate their membership.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireRequestAuth(req);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await req.json();
    const action = typeof body?.action === 'string' ? body.action : '';
    const userId = typeof body?.userId === 'string' ? body.userId : '';
    if (!userId) return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    if (!['resend', 'revoke'].includes(action)) {
      return NextResponse.json({ error: 'Action must be resend or revoke' }, { status: 400 });
    }
    if (userId === session.user.id) {
      return NextResponse.json({ error: 'You cannot manage your own account as a pending invitation.' }, { status: 409 });
    }

    const db = getDb();
    const [[membership], [targetUser], [tenant]] = await Promise.all([
      db
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
        .limit(1),
      db
        .select({
          id: user.id,
          email: user.email,
          name: user.name,
          emailVerified: user.emailVerified,
        })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1),
      db
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, session.tenantId))
        .limit(1),
    ]);

    if (!membership || !targetUser) {
      return NextResponse.json({ error: 'Invitation account not found in your organisation' }, { status: 404 });
    }
    if (targetUser.emailVerified) {
      return NextResponse.json(
        { error: 'This account is already activated. Manage its access from User Management instead.' },
        { status: 409 },
      );
    }

    if (action === 'revoke') {
      if (membership.status !== 'active') {
        return NextResponse.json(
          { error: 'This invitation is no longer active.' },
          { status: 409 },
        );
      }

      await db.transaction(async (tx) => {
        const [lockedUser] = await tx
          .select({ emailVerified: user.emailVerified })
          .from(user)
          .where(eq(user.id, userId))
          .limit(1)
          .for('update');
        if (!lockedUser || lockedUser.emailVerified) {
          throw new Error(INVITATION_STATE_CONFLICT);
        }

        const [revokedMembership] = await tx
          .update(tenantMemberships)
          .set({ status: 'suspended' })
          .where(
            and(
              eq(tenantMemberships.id, membership.id),
              eq(tenantMemberships.tenantId, session.tenantId),
              eq(tenantMemberships.status, 'active'),
            ),
          )
          .returning({ id: tenantMemberships.id });
        if (!revokedMembership) throw new Error(INVITATION_STATE_CONFLICT);

        await recordAuditEvent({
          tenantId: session.tenantId,
          actorUserId: session.user.id,
          action: 'user_invitation.revoked',
          entityType: 'tenant_membership',
          entityId: membership.id,
          before: { status: 'active', emailVerified: false },
          after: { status: 'suspended', emailVerified: false },
          summary: `Pending account invitation revoked for ${targetUser.email}`,
        }, tx);
      });

      return NextResponse.json({
        success: true,
        data: { message: `Invitation for ${targetUser.email} has been revoked.` },
      });
    }

    if (membership.status !== 'active') {
      return NextResponse.json(
        { error: 'This invitation has been revoked or its membership is not active. Restore access deliberately from User Management before issuing new credentials.' },
        { status: 409 },
      );
    }

    const [credentialAccount] = await db
      .select({ id: account.id, password: account.password })
      .from(account)
      .where(and(eq(account.userId, userId), eq(account.providerId, 'email')))
      .limit(1);
    if (!credentialAccount?.password) {
      return NextResponse.json(
        { error: 'The invitation account has no password credential to rotate.' },
        { status: 409 },
      );
    }

    const previousPasswordHash = credentialAccount.password;
    const tempPassword = `Gf!${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const passwordHash = await bcrypt.hash(tempPassword, 10);

    await db.transaction(async (tx) => {
      const [lockedUser] = await tx
        .select({ emailVerified: user.emailVerified })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1)
        .for('update');
      if (!lockedUser || lockedUser.emailVerified) {
        throw new Error(INVITATION_STATE_CONFLICT);
      }

      const [lockedMembership] = await tx
        .select({ status: tenantMemberships.status })
        .from(tenantMemberships)
        .where(
          and(
            eq(tenantMemberships.id, membership.id),
            eq(tenantMemberships.tenantId, session.tenantId),
          ),
        )
        .limit(1)
        .for('update');
      if (lockedMembership?.status !== 'active') {
        throw new Error(INVITATION_STATE_CONFLICT);
      }

      const [rotatedCredential] = await tx
        .update(account)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(
          and(
            eq(account.id, credentialAccount.id),
            eq(account.password, previousPasswordHash),
          ),
        )
        .returning({ id: account.id });
      if (!rotatedCredential) throw new Error(INVITATION_CREDENTIAL_CONFLICT);

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'user_invitation.credential_rotated',
        entityType: 'tenant_membership',
        entityId: membership.id,
        after: {
          userId,
          email: targetUser.email,
          temporaryCredentialRotated: true,
          deliveryPending: true,
        },
        summary: `Temporary invitation credential rotated for ${targetUser.email}; delivery pending`,
      }, tx);
    });

    const loginUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'https://grn-fleet-system.vercel.app'}/login`;
    const element = createElement(UserInviteEmail, {
      tenantName: tenant?.name || 'GovFleet Namibia',
      recipientName: targetUser.name || targetUser.email.split('@')[0],
      recipientEmail: targetUser.email,
      tempPassword,
      loginUrl,
      invitedByName: session.user.name || 'A tenant administrator',
    });

    let emailSent = false;
    let emailError: string | null = null;
    try {
      const result = await sendReactEmail(
        targetUser.email,
        `Your ${tenant?.name || 'GovFleet'} account invitation`,
        element,
      );
      emailSent = result.success;
      emailError = result.error ?? null;
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Email delivery failed';
    }

    if (!emailSent) {
      // Restore the previous credential only if this resend still owns the hash
      // it installed. A later credential change must never be overwritten by a
      // stale email-failure rollback.
      const [restoredCredential] = await db
        .update(account)
        .set({ password: previousPasswordHash, updatedAt: new Date() })
        .where(and(eq(account.id, credentialAccount.id), eq(account.password, passwordHash)))
        .returning({ id: account.id });

      await recordAuditEvent({
        tenantId: session.tenantId,
        actorUserId: session.user.id,
        action: 'user_invitation.resend_failed',
        entityType: 'tenant_membership',
        entityId: membership.id,
        after: {
          userId,
          email: targetUser.email,
          emailSent: false,
          temporaryCredentialRestored: Boolean(restoredCredential),
          newerCredentialPreserved: !restoredCredential,
        },
        summary: restoredCredential
          ? `Invitation resend failed for ${targetUser.email}; previous credential preserved`
          : `Invitation resend failed for ${targetUser.email}; a newer credential change was preserved`,
      }).catch(() => undefined);

      return NextResponse.json(
        { error: emailError || 'Invitation email could not be delivered. No newer credential was overwritten.' },
        { status: 502 },
      );
    }

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'user_invitation.resent',
      entityType: 'tenant_membership',
      entityId: membership.id,
      after: {
        userId,
        email: targetUser.email,
        emailSent: true,
        temporaryCredentialRotated: true,
      },
      summary: `Pending account invitation reissued for ${targetUser.email}`,
    }).catch(() => undefined);

    return NextResponse.json({
      success: true,
      data: {
        message: `Invitation re-sent to ${targetUser.email}.`,
        emailSent: true,
      },
    });
  } catch (error) {
    console.error('[Admin Invites] POST failed:', error);
    if (
      error instanceof Error &&
      (error.message === INVITATION_STATE_CONFLICT ||
        error.message === INVITATION_CREDENTIAL_CONFLICT)
    ) {
      return NextResponse.json(
        {
          error:
            'This invitation changed while the action was being processed. Refresh Invitations and review its current activation, membership and credential state before retrying.',
        },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Failed to process invitation action' }, { status: 500 });
  }
}
