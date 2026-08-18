import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenantInvitations } from '@/db/schema/invitations';
import { tenants } from '@/db/schema/tenants';
import { and, desc, eq } from 'drizzle-orm';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import {
  generateInvitationToken,
  invitationAcceptUrl,
  INVITATION_TTL_DAYS,
  markInvitationSent,
} from '@/lib/platform/invitations';
import { sendInvitationEmail } from '@/lib/platform/email-templates';
import { recordAuditEvent } from '@/lib/audit-event';

async function requirePlatformTenantManage(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.TENANT_MANAGE);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  return auth;
}

async function loadTenantAdminInvitation(tenantId: string) {
  const db = getDb();
  const [tenant] = await db
    .select({ id: tenants.id, name: tenants.name, lifecycleStatus: tenants.lifecycleStatus })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) return null;

  const [invitation] = await db
    .select()
    .from(tenantInvitations)
    .where(and(eq(tenantInvitations.tenantId, tenantId), eq(tenantInvitations.type, 'tenant_admin')))
    .orderBy(desc(tenantInvitations.createdAt))
    .limit(1);

  return { tenant, invitation: invitation ?? null };
}

function publicInvitationState(invitation: NonNullable<Awaited<ReturnType<typeof loadTenantAdminInvitation>>>['invitation']) {
  if (!invitation) return null;
  const expired =
    (invitation.status === 'pending' || invitation.status === 'sent') &&
    invitation.expiresAt.getTime() < Date.now();
  return {
    id: invitation.id,
    email: invitation.email,
    name: invitation.name,
    status: expired ? 'expired' : invitation.status,
    expiresAt: invitation.expiresAt,
    sentAt: invitation.sentAt,
    acceptedAt: invitation.acceptedAt,
    createdAt: invitation.createdAt,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePlatformTenantManage(request);
    if (!auth.ok) return auth.error;
    const { id } = await params;
    const result = await loadTenantAdminInvitation(id);
    if (!result) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    return NextResponse.json({
      success: true,
      data: {
        tenant: result.tenant,
        invitation: publicInvitationState(result.invitation),
        emailConfigured: Boolean(process.env.RESEND_API_KEY),
        invitationTtlDays: INVITATION_TTL_DAYS,
      },
    });
  } catch (error) {
    console.error('[AdminInvitation] GET failed:', error);
    return NextResponse.json({ error: 'Could not load administrator invitation' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requirePlatformTenantManage(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const { id } = await params;
    const result = await loadTenantAdminInvitation(id);
    if (!result) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    if (!result.invitation) {
      return NextResponse.json(
        { error: 'No Tenant Administrator invitation exists for this tenant.' },
        { status: 404 },
      );
    }
    if (result.invitation.status === 'accepted') {
      return NextResponse.json(
        { error: 'The Tenant Administrator invitation has already been accepted.' },
        { status: 409 },
      );
    }

    const db = getDb();
    const { raw, hash } = generateInvitationToken();
    const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await db
      .update(tenantInvitations)
      .set({
        token: hash,
        status: 'pending',
        sentAt: null,
        acceptedAt: null,
        expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(tenantInvitations.id, result.invitation.id));

    const acceptUrl = invitationAcceptUrl(raw);
    const emailConfigured = Boolean(process.env.RESEND_API_KEY);
    let emailSent = false;
    let emailError: string | null = null;

    if (emailConfigured) {
      const sendResult = await sendInvitationEmail({
        to: result.invitation.email,
        tenantName: result.tenant.name,
        inviteeName: result.invitation.name || result.invitation.email,
        invitedByName: session.user.name || 'Platform Administrator',
        acceptUrl,
        expiresAt,
      });
      emailSent = sendResult.success;
      if (sendResult.success) {
        await markInvitationSent(result.invitation.id);
      } else {
        emailError = sendResult.error || 'Email delivery failed';
      }
    }

    await recordAuditEvent({
      tenantId: id,
      actorUserId: session.user.id,
      action: 'tenant_admin.invitation_rotated',
      entityType: 'tenant_invitation',
      entityId: result.invitation.id,
      summary: emailSent
        ? `Tenant Administrator invitation regenerated and emailed to ${result.invitation.email}`
        : `Tenant Administrator invitation regenerated for manual delivery to ${result.invitation.email}`,
      after: {
        expiresAt,
        emailConfigured,
        emailSent,
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        invitation: {
          id: result.invitation.id,
          email: result.invitation.email,
          name: result.invitation.name,
          status: emailSent ? 'sent' : 'pending',
          expiresAt,
          sentAt: emailSent ? new Date() : null,
          acceptedAt: null,
        },
        acceptUrl,
        emailConfigured,
        emailSent,
        emailError,
      },
    });
  } catch (error) {
    console.error('[AdminInvitation] POST failed:', error);
    return NextResponse.json({ error: 'Could not regenerate administrator invitation' }, { status: 500 });
  }
}
