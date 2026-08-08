/**
 * Platform email templates — invitation emails for Tenant Administrators.
 *
 * Uses the existing email service (Resend) with an inline branded HTML
 * template tailored to platform onboarding invitations.
 */

import { sendPlainEmail } from '@/lib/email';

// ---------------------------------------------------------------------------
// Invitation email
// ---------------------------------------------------------------------------

export interface InvitationEmailInput {
  to: string;
  tenantName: string;
  inviteeName: string;
  invitedByName: string;
  acceptUrl: string;
  expiresAt: Date;
  message?: string;
}

function invitationHtml(input: InvitationEmailInput): string {
  const expiresLabel = input.expiresAt.toLocaleDateString('en-NA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const accentColor = '#1F4E8C';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 0;text-align:center;">
              <h1 style="margin:0;font-size:16px;font-weight:700;color:${accentColor};letter-spacing:0.5px;text-transform:uppercase;">GovFleet Namibia</h1>
              <hr style="border:none;border-top:2px solid ${accentColor};margin:12px auto;width:48px;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:16px 32px 8px;">
              <p style="margin:0 0 8px;font-size:14px;color:#52525b;">Hello ${input.inviteeName},</p>
              <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#18181b;">You've been invited to administer ${input.tenantName}</h2>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;">
                ${input.invitedByName} has invited you to act as the Tenant Administrator for
                <strong>${input.tenantName}</strong> on the Government Fleet Management Platform.
                Accept this invitation to set up your organisation, configure roles and
                begin managing your fleet.
              </p>
              ${input.message ? `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;font-style:italic;">"${input.message}"</p>` : ''}
              <p style="margin:0 0 16px;font-size:12px;color:#a1a1aa;">
                This invitation will expire on <strong>${expiresLabel}</strong>. For security,
                this link can only be used once.
              </p>
            </td>
          </tr>
          <!-- CTA -->
          <tr>
            <td style="padding:0 32px 24px;">
              <a href="${input.acceptUrl}" style="display:inline-block;padding:12px 28px;border-radius:8px;background:${accentColor};color:#fff;font-size:14px;font-weight:600;text-decoration:none;">Accept Invitation</a>
              <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;">
                If the button doesn't work, copy and paste this link into your browser:<br />
                <span style="color:#52525b;word-break:break-all;">${input.acceptUrl}</span>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background:#f4f4f5;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                The Government Fleet Management Platform — modernising transport for
                Namibia's public service.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

export async function sendInvitationEmail(
  input: InvitationEmailInput,
): Promise<{ success: boolean; id?: string; error?: string }> {
  // Prefer the plain HTML renderer (no React Email dependency).
  try {
    const { Resend } = await import('resend');
    const env = (await import('@/env')).env;
    if (env.RESEND_API_KEY) {
      const client = new Resend(env.RESEND_API_KEY);
      const result = await client.emails.send({
        from: env.EMAIL_FROM || 'noreply@govfleet.gov.na',
        to: input.to,
        subject: `You're invited to administer ${input.tenantName}`,
        html: invitationHtml(input),
      });
      return { success: true, id: result.data?.id };
    }
  } catch (err) {
    console.warn('[InvitationEmail] Resend send failed:', err);
  }

  // Fallback: try the generic email service.
  return sendPlainEmail(
    input.to,
    `You're invited to administer ${input.tenantName}`,
    [
      `Hello ${input.inviteeName},`,
      '',
      `${input.invitedByName} has invited you to administer ${input.tenantName} on the Government Fleet Management Platform.`,
      input.message ? `Message: ${input.message}` : '',
      '',
      `Accept the invitation here (expires ${input.expiresAt.toLocaleDateString()}):`,
      input.acceptUrl,
      '',
      'This link is single-use. If you did not expect this invitation, you can safely ignore it.',
    ]
      .filter(Boolean)
      .join('\n'),
  );
}