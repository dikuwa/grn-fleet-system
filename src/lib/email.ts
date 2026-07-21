/**
 * Email Notification Service
 *
 * Uses Resend to send transactional fleet emails via React Email templates.
 * Falls back to inline HTML when React Email SSR is unavailable.
 *
 * NOTE: React Email components are dynamically imported to avoid
 * Next.js 16 build errors with react-dom/server references in
 * server-side contexts.
 */

import { env, hasEnvVar } from '@/env';
import { createElement } from 'react';

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
  requestReference?: string;
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
    console.warn('Email service: Resend SDK not available');
    return null;
  }
}

function getFromAddress(): string {
  return env.EMAIL_FROM || 'noreply@govfleet.gov.na';
}

// ---------------------------------------------------------------------------
// React Email template rendering
// ---------------------------------------------------------------------------

/** Render a React element to an HTML string */
async function renderReactEmail(element: React.ReactElement): Promise<string> {
  const { renderToString } = await import('react-dom/server');
  return renderToString(element);
}

interface TemplateEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  component: React.ComponentType<any>;
  buildProps: (data: NotificationEmailData) => Record<string, unknown>;
}

const stripEmoji = (s: string) => s.replace(/^[✅❌🚗📋⚠️⏰🔴🎉]\s*/u, '');

/** Lazy-load the template registry on first access to avoid React Email imports at module level */
async function getTemplateRegistry(): Promise<Record<string, TemplateEntry>> {
  const [
    RequestApprovedEmail,
    RequestRejectedEmail,
    VehicleReleasedEmail,
    TripAuthorisedEmail,
    EmergencyOverrideEmail,
    ReminderEmail,
    AuditNotificationEmail,
    DocumentExpiryEmail,
  ] = await Promise.all([
    import('@/emails/request-approved').then((m) => m.RequestApprovedEmail),
    import('@/emails/request-rejected').then((m) => m.RequestRejectedEmail),
    import('@/emails/vehicle-released').then((m) => m.VehicleReleasedEmail),
    import('@/emails/trip-authorised').then((m) => m.TripAuthorisedEmail),
    import('@/emails/emergency-override').then((m) => m.EmergencyOverrideEmail),
    import('@/emails/reminder').then((m) => m.ReminderEmail),
    import('@/emails/audit-notification').then((m) => m.AuditNotificationEmail),
    import('@/emails/document-expiry').then((m) => m.DocumentExpiryEmail),
  ]);

  return {
    request_approved: {
      component: RequestApprovedEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        requestReference: stripEmoji(data.title),
        requestUrl: data.actionUrl,
      }),
    },
    request_rejected: {
      component: RequestRejectedEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        requestReference: stripEmoji(data.title),
        reason: data.body,
        requestUrl: data.actionUrl,
      }),
    },
    request_returned: {
      component: RequestRejectedEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        requestReference: stripEmoji(data.title),
        reason: `Returned for revision: ${data.body}`,
        requestUrl: data.actionUrl,
      }),
    },
    vehicle_released: {
      component: VehicleReleasedEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        requestReference: data.requestReference || stripEmoji(data.title),
        requestUrl: data.actionUrl,
      }),
    },
    trip_authorised: {
      component: TripAuthorisedEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        requestReference: data.requestReference || stripEmoji(data.title),
        requestUrl: data.actionUrl,
      }),
    },
    emergency_override: {
      component: EmergencyOverrideEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        requestReference: data.requestReference || stripEmoji(data.title),
        reason: data.body,
        requestUrl: data.actionUrl,
      }),
    },
    reminder: {
      component: ReminderEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        taskDescription: data.title,
        entityType: 'Workflow',
        entityReference: '',
        isEscalation: false,
        actionUrl: data.actionUrl,
      }),
    },
    escalation: {
      component: ReminderEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        taskDescription: data.title,
        entityType: 'Workflow',
        entityReference: '',
        isEscalation: true,
        actionUrl: data.actionUrl,
      }),
    },
    fuel_created: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    maintenance_created: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    region_created: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    region_updated: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    region_deleted: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    trip_started: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    trip_returned: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    trip_closed: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    allocation_created: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    document_issued: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    document_superseded: {
      component: AuditNotificationEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        title: stripEmoji(data.title),
        body: data.body,
        actionUrl: data.actionUrl,
        entityType: data.type,
        entitySummary: stripEmoji(data.title),
      }),
    },
    document_expiry: {
      component: DocumentExpiryEmail,
      buildProps: (data) => ({
        recipientName: data.recipientName,
        tenantName: data.tenantName,
        documentType: data.type.replace('document_expiry_', ''),
        documentReference: stripEmoji(data.title),
        expiryDate: data.body.split('on ')[1]?.split(' ')[0] || new Date().toISOString().split('T')[0],
        daysRemaining: 0,
        actionUrl: data.actionUrl,
      }),
    },
  };
}

/** Cache the registry after first load */
let registryCache: Record<string, TemplateEntry> | null = null;

async function getRegistry(): Promise<Record<string, TemplateEntry>> {
  if (registryCache) return registryCache;
  registryCache = await getTemplateRegistry();
  return registryCache;
}

/** Render the appropriate React Email template based on notification type */
async function renderTemplate(data: NotificationEmailData): Promise<string | null> {
  try {
    const registry = await getRegistry();
    const entry = registry[data.type];
    if (!entry) return null;

    const props = entry.buildProps(data);
    const element = createElement(entry.component, props);
    return await renderReactEmail(element);
  } catch (err) {
    console.warn('[Email] React Email rendering failed, falling back to inline HTML:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Render helpers — inline HTML (fallback when React Email templates are not suitable)
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
 * Send a plain text email (e.g. for password reset, account creation).
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
 * Send a React Email component directly by rendering it to HTML.
 * Useful for custom transactional emails.
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
    const html = await renderReactEmail(element);
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
