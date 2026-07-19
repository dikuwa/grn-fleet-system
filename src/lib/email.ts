/**
 * Email Notification Service
 *
 * Uses Resend to send transactional fleet emails via React Email templates.
 * Falls back to inline HTML when React Email SSR is unavailable.
 */

import { env, hasEnvVar } from '@/env';
import { renderToString } from 'react-dom/server';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationEmailData {
  to: string;
  type: string;
  title: string;
  body: string;
  actionUrl?: string;
  recipientName: string;
  tenantName?: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let resendClient: any = null;

async function getResend() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (resendClient) return resendClient as any;
  if (!hasEnvVar('RESEND_API_KEY') || !env.RESEND_API_KEY) {
    return null;
  }
  try {
    const { Resend } = await import('resend');
    resendClient = new Resend(env.RESEND_API_KEY);
    return resendClient;
  } catch {
    console.warn('Resend SDK not available');
    return null;
  }
}

function getFromAddress(): string {
  return env.EMAIL_FROM || 'noreply@govfleet.gov.na';
}

// ---------------------------------------------------------------------------
// React Email template rendering
// ---------------------------------------------------------------------------

/** Render a React Email component to HTML string using renderToString */
function renderReactEmail(element: React.ReactElement): string {
  return renderToString(element);
}

/** Select and render the appropriate React Email template based on type */
async function renderTemplate(data: NotificationEmailData): Promise<string | null> {
  try {
    const React = await import('react');
    let element: React.ReactElement;

    switch (data.type) {
      case 'request_approved':
        const { RequestApprovedEmail } = await import('@/emails/request-approved');
        element = React.createElement(RequestApprovedEmail, {
          recipientName: data.recipientName,
          requestReference: data.title.replace(/.*?: /, ''),
          requestUrl: data.actionUrl,
          tenantName: data.tenantName,
        });
        break;
      case 'request_rejected':
      case 'request_returned':
        const { RequestRejectedEmail } = await import('@/emails/request-rejected');
        element = React.createElement(RequestRejectedEmail, {
          recipientName: data.recipientName,
          requestReference: data.title.replace(/.*?: /, ''),
          reason: data.body,
          requestUrl: data.actionUrl,
          tenantName: data.tenantName,
        });
        break;
      case 'vehicle_released':
        const { VehicleReleasedEmail } = await import('@/emails/vehicle-released');
        element = React.createElement(VehicleReleasedEmail, {
          recipientName: data.recipientName,
          requestReference: data.title.replace(/.*?: /, ''),
          requestUrl: data.actionUrl,
          tenantName: data.tenantName,
        });
        break;
      case 'trip_authorised':
        const { TripAuthorisedEmail } = await import('@/emails/trip-authorised');
        element = React.createElement(TripAuthorisedEmail, {
          recipientName: data.recipientName,
          requestReference: data.title.replace(/.*?: /, ''),
          requestUrl: data.actionUrl,
          tenantName: data.tenantName,
        });
        break;
      case 'emergency_override':
        const { EmergencyOverrideEmail } = await import('@/emails/emergency-override');
        element = React.createElement(EmergencyOverrideEmail, {
          recipientName: data.recipientName,
          requestReference: data.title.replace(/.*?: /, ''),
          reason: data.body,
          requestUrl: data.actionUrl,
          tenantName: data.tenantName,
        });
        break;
      case 'reminder':
      case 'escalation':
        const { ReminderEmail } = await import('@/emails/reminder');
        element = React.createElement(ReminderEmail, {
          recipientName: data.recipientName,
          taskDescription: data.title,
          entityType: 'Workflow',
          entityReference: '',
          isEscalation: data.type === 'escalation',
          actionUrl: data.actionUrl,
          tenantName: data.tenantName,
        });
        break;
      default:
        // Fall through to inline HTML render
        return null;
    }

    if (!element) return null;
    return renderReactEmail(element);
  } catch (err) {
    console.warn('[Email] React Email rendering failed, falling back to inline HTML:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Render helpers — inline HTML (fallback when React Email templates unavailable)
// ---------------------------------------------------------------------------

function renderInlineHtml(data: NotificationEmailData): string {
  const isEmergency = data.type === 'emergency';
  const accentColor = isEmergency ? '#dc2626' : '#1F4E8C';

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
              <h1 style="margin:0;font-size:16px;font-weight:700;color:${accentColor};letter-spacing:0.5px;text-transform:uppercase;">${data.tenantName || 'GovFleet Namibia'}</h1>
              <hr style="border:none;border-top:2px solid ${accentColor};margin:12px auto;width:48px;" />
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:16px 32px 8px;">
              <p style="margin:0 0 8px;font-size:14px;color:#52525b;">Hi ${data.recipientName},</p>
              <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:#18181b;">${data.title}</h2>
              <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#52525b;">${data.body}</p>
            </td>
          </tr>
          <!-- CTA -->
          ${data.actionUrl ? `
          <tr>
            <td style="padding:0 32px 24px;">
              <a href="${data.actionUrl}" style="display:inline-block;padding:10px 24px;border-radius:8px;background:${accentColor};color:#fff;font-size:14px;font-weight:500;text-decoration:none;">View Details</a>
            </td>
          </tr>` : ''}
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background:#f4f4f5;">
              <p style="margin:0;font-size:12px;color:#a1a1aa;">
                This is an automated notification from the Government Fleet Management System.
                Please do not reply to this email.
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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send a notification email via Resend.
 * Uses React Email templates via renderToString, falls back to inline HTML.
 * Returns `{ success: false, error }` if email is not configured.
 */
export async function sendNotificationEmail(
  data: NotificationEmailData,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const client = await getResend();
  if (!client) {
    const error =
      'Email service not configured. Set RESEND_API_KEY to enable email notifications.';
    console.warn(`[Email] ${error}`);
    return { success: false, error };
  }

  // Try React Email template first, fall back to inline HTML
  let html = await renderTemplate(data);
  if (!html) {
    html = renderInlineHtml(data);
  }

  try {
    const result = await client.emails.send({
      from: `${data.tenantName || 'GovFleet'} <${getFromAddress()}>`,
      to: data.to,
      subject: `[${data.type.toUpperCase()}] ${data.title}`,
      html,
    });

    return { success: true, id: result.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[Email] Send failed:', message);
    return { success: false, error: message };
  }
}

/**
 * Send a simple text email (e.g. for password reset, account creation).
 */
export async function sendPlainEmail(
  to: string | string[],
  subject: string,
  text: string,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const client = await getResend();
  if (!client) {
    return { success: false, error: 'Email service not configured.' };
  }

  try {
    const result = await client.emails.send({
      from: `GovFleet <${getFromAddress()}>`,
      to,
      subject,
      text,
    });

    return { success: true, id: result.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/**
 * Send a React Email template directly by rendering it to HTML.
 * Useful for emails that don't fit the standard notification pattern.
 */
export async function sendReactEmail(
  to: string | string[],
  subject: string,
  element: React.ReactElement,
): Promise<{ success: boolean; id?: string; error?: string }> {
  const client = await getResend();
  if (!client) {
    return { success: false, error: 'Email service not configured.' };
  }

  try {
    const html = renderReactEmail(element);
    const result = await client.emails.send({
      from: `GovFleet <${getFromAddress()}>`,
      to,
      subject,
      html,
    });

    return { success: true, id: result.data?.id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
