/**
 * Tenant Settings API
 *
 * GET  /api/settings — Get tenant settings (profile, branding, current user's notification prefs)
 * POST /api/settings — Update tenant settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { notificationPreferences } from '@/db/schema/notifications';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { recordAuditEvent } from '@/lib/audit-event';

const SUPPORTED_TIMEZONES = new Set(['Africa/Windhoek']);
const SUPPORTED_LOCALES = new Set(['en-NA']);
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeTimezone(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // Accept the old UI label so existing clients are repaired to the canonical
  // IANA timezone instead of persisting presentation text in tenant data.
  if (trimmed === 'Africa/Windhoek (CAT, UTC+2)') return 'Africa/Windhoek';
  return SUPPORTED_TIMEZONES.has(trimmed) ? trimmed : null;
}

async function requireTenantSettingsAccess(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth;
  const permission = await requirePermission(auth.session, Permissions.TENANT_VIEW);
  if (permission instanceof NextResponse) return { ok: false as const, error: permission };
  return auth;
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requireTenantSettingsAccess(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, session.tenantId))
      .limit(1);

    if (!tenant) return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });

    const [branding] = await db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, session.tenantId))
      .limit(1)
      .then((rows) => rows.length > 0 ? rows : [{
        contactEmail: '',
        contactPhone: '',
        address: '',
        primaryColor: '#1F4E8C',
        accentColor: '#0F766E',
        documentFooter: '',
        senderName: '',
        senderEmail: '',
      }]);

    const [notifPrefs] = await db
      .select()
      .from(notificationPreferences)
      .where(and(
        eq(notificationPreferences.tenantId, session.tenantId),
        eq(notificationPreferences.userId, session.user.id),
      ))
      .limit(1)
      .then((rows) => rows.length > 0 ? rows : [{
        emailNotifications: true,
        inAppNotifications: true,
        quietHoursStart: '20:00',
        quietHoursEnd: '07:00',
        emergencyBypassQuietHours: true,
      }]);

    return NextResponse.json({
      success: true,
      data: {
        tenant: {
          ...tenant,
          timezone: normalizeTimezone(tenant.timezone) ?? 'Africa/Windhoek',
        },
        branding,
        notificationPreferences: notifPrefs,
      },
    });
  } catch (error) {
    console.error('[Settings] GET failed:', error);
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const db = getDb();

    if (body.tenant?.name !== undefined && (
      typeof body.tenant.name !== 'string' || !body.tenant.name.trim() || body.tenant.name.length > 200
    )) {
      return NextResponse.json(
        { error: 'Organisation name is required and must be under 200 characters.' },
        { status: 422 },
      );
    }

    let timezone: string | undefined;
    if (body.tenant?.timezone !== undefined) {
      const normalized = normalizeTimezone(body.tenant.timezone);
      if (!normalized) {
        return NextResponse.json({ error: 'Select a supported timezone.' }, { status: 422 });
      }
      timezone = normalized;
    }

    if (body.tenant?.locale !== undefined && !SUPPORTED_LOCALES.has(body.tenant.locale)) {
      return NextResponse.json({ error: 'Select a supported locale.' }, { status: 422 });
    }

    if (body.branding?.primaryColor !== undefined && !/^#[0-9a-f]{6}$/i.test(body.branding.primaryColor)) {
      return NextResponse.json({ error: 'Primary colour must be a six-digit hex colour.' }, { status: 422 });
    }
    if (body.branding?.accentColor !== undefined && !/^#[0-9a-f]{6}$/i.test(body.branding.accentColor)) {
      return NextResponse.json({ error: 'Accent colour must be a six-digit hex colour.' }, { status: 422 });
    }
    for (const email of [body.branding?.contactEmail, body.branding?.senderEmail]) {
      if (email && (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
        return NextResponse.json(
          { error: 'Enter a valid contact and sender email address.' },
          { status: 422 },
        );
      }
    }

    const prefs = body.notificationPreferences;
    if (prefs) {
      for (const value of [prefs.emailNotifications, prefs.inAppNotifications, prefs.emergencyBypassQuietHours]) {
        if (value !== undefined && typeof value !== 'boolean') {
          return NextResponse.json({ error: 'Notification preference values must be true or false.' }, { status: 422 });
        }
      }
      if (prefs.quietHoursStart !== undefined && (typeof prefs.quietHoursStart !== 'string' || !TIME_PATTERN.test(prefs.quietHoursStart))) {
        return NextResponse.json({ error: 'Quiet-hours start must use HH:MM format.' }, { status: 422 });
      }
      if (prefs.quietHoursEnd !== undefined && (typeof prefs.quietHoursEnd !== 'string' || !TIME_PATTERN.test(prefs.quietHoursEnd))) {
        return NextResponse.json({ error: 'Quiet-hours end must use HH:MM format.' }, { status: 422 });
      }
    }

    if (body.tenant) {
      const tenantUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (body.tenant.name !== undefined) tenantUpdate.name = body.tenant.name.trim();
      if (timezone !== undefined) tenantUpdate.timezone = timezone;
      if (body.tenant.locale !== undefined) tenantUpdate.locale = body.tenant.locale;
      if (Object.keys(tenantUpdate).length > 1) {
        await db.update(tenants).set(tenantUpdate).where(eq(tenants.id, session.tenantId));
      }
    }

    if (body.branding) {
      const brandingUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (body.branding.contactEmail !== undefined) brandingUpdate.contactEmail = body.branding.contactEmail.trim();
      if (body.branding.contactPhone !== undefined) brandingUpdate.contactPhone = String(body.branding.contactPhone).trim();
      if (body.branding.address !== undefined) brandingUpdate.address = String(body.branding.address).trim();
      if (body.branding.primaryColor !== undefined) brandingUpdate.primaryColor = body.branding.primaryColor;
      if (body.branding.accentColor !== undefined) brandingUpdate.accentColor = body.branding.accentColor;
      if (body.branding.documentFooter !== undefined) brandingUpdate.documentFooter = String(body.branding.documentFooter).trim();
      if (body.branding.senderName !== undefined) brandingUpdate.senderName = String(body.branding.senderName).trim();
      if (body.branding.senderEmail !== undefined) brandingUpdate.senderEmail = body.branding.senderEmail.trim();

      const [existingBranding] = await db
        .select()
        .from(tenantBranding)
        .where(eq(tenantBranding.tenantId, session.tenantId))
        .limit(1);

      if (existingBranding) {
        await db.update(tenantBranding).set(brandingUpdate).where(eq(tenantBranding.tenantId, session.tenantId));
      } else {
        await db.insert(tenantBranding).values({
          tenantId: session.tenantId,
          ...brandingUpdate,
        } as typeof tenantBranding.$inferInsert);
      }
    }

    if (prefs) {
      const prefUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (prefs.emailNotifications !== undefined) prefUpdate.emailNotifications = prefs.emailNotifications;
      if (prefs.inAppNotifications !== undefined) prefUpdate.inAppNotifications = prefs.inAppNotifications;
      if (prefs.quietHoursStart !== undefined) prefUpdate.quietHoursStart = prefs.quietHoursStart;
      if (prefs.quietHoursEnd !== undefined) prefUpdate.quietHoursEnd = prefs.quietHoursEnd;
      if (prefs.emergencyBypassQuietHours !== undefined) prefUpdate.emergencyBypassQuietHours = prefs.emergencyBypassQuietHours;

      const [existingPrefs] = await db
        .select()
        .from(notificationPreferences)
        .where(and(
          eq(notificationPreferences.tenantId, session.tenantId),
          eq(notificationPreferences.userId, session.user.id),
        ))
        .limit(1);

      if (existingPrefs) {
        await db.update(notificationPreferences).set(prefUpdate).where(eq(notificationPreferences.id, existingPrefs.id));
      } else {
        await db.insert(notificationPreferences).values({
          tenantId: session.tenantId,
          userId: session.user.id,
          ...prefUpdate,
        } as typeof notificationPreferences.$inferInsert);
      }
    }

    await recordAuditEvent({
      tenantId: session.tenantId,
      actorUserId: session.user.id,
      action: 'tenant.settings_updated',
      entityType: 'tenant',
      entityId: session.tenantId,
      summary: 'Tenant settings updated',
      after: {
        tenant: body.tenant ? { ...body.tenant, timezone: timezone ?? body.tenant.timezone } : null,
        branding: body.branding || null,
        notificationPreferences: prefs || null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Settings] POST failed:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
