/**
 * Platform Tenant Invitation API
 *
 * POST /api/platform/onboard/invite — Create and send a Tenant Administrator invitation
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { createInvitation, markInvitationSent } from '@/lib/platform/invitations';
import { sendInvitationEmail } from '@/lib/platform/email-templates';
import { getPackageById } from '@/lib/platform/packages';

// ---------------------------------------------------------------------------
// POST — Create a new Tenant Administrator invitation
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const {
      tenantId,
      email,
      name,
      type = 'tenant_admin',
      packageId,
      message,
      roleIds,
    } = body;

    if (!tenantId || !email || !name) {
      return NextResponse.json(
        { error: 'Tenant ID, email, and name are required' },
        { status: 400 },
      );
    }

    // Verify package exists (optional for direct invites)
    let packageInfo = null;
    if (packageId) {
      packageInfo = await getPackageById(packageId);
      if (!packageInfo) {
        return NextResponse.json({ error: 'Package not found' }, { status: 400 });
      }
    }

    // Create invitation
    const { invitation, rawToken } = await createInvitation({
      tenantId,
      email,
      name,
      type,
      message,
      roleIds,
      invitedByUserId: session.user.id,
      ttlDays: 7,
    });

    // Mark as sent and attempt email delivery
    await markInvitationSent(invitation.id);

    const acceptUrl = `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/accept-invite?token=${rawToken}`;

    let emailSent = false;
    try {
      await sendInvitationEmail({
        to: invitation.email,
        tenantName: invitation.tenantName,
        inviteeName: invitation.name || invitation.email,
        invitedByName: session.user.name ?? 'Platform Administrator',
        acceptUrl,
        expiresAt: invitation.expiresAt,
        message,
      });
      emailSent = true;
    } catch (emailError) {
      console.error('[Onboard Invite] Email send failed:', emailError);
      // Don't fail the request — the invitation exists and can be resent
    }

    return NextResponse.json({
      success: true,
      data: {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          name: invitation.name,
          type: invitation.type,
          sent: emailSent,
        },
        acceptUrl,
      },
    });
  } catch (error) {
    console.error('[Onboard Invite] POST failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}