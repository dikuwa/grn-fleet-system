/**
 * Tenant Settings API
 *
 * GET  /api/settings  — Get tenant settings (profile, branding, notification prefs)
 * POST /api/settings  — Update tenant settings
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { tenants, tenantBranding } from '@/db/schema/tenants';
import { notificationPreferences } from '@/db/schema/notifications';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
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
      .then((r) => (r.length > 0 ? r : [{ contactEmail: '', contactPhone: '', address: '', primaryColor: '#1F4E8C', accentColor: '#0F766E', documentFooter: '', senderName: '', senderEmail: '' }]));

    const [notifPrefs] = await db
      .select()
      .from(notificationPreferences)
      .where(
        and(
          eq(notificationPreferences.tenantId, session.tenantId),
          eq(notificationPreferences.userId, session.user.id),
        ),
      )
      .limit(1)
      .then((r) => (r.length > 0 ? r : [{ emailNotifications: true, inAppNotifications: true, quietHoursStart: '20:00', quietHoursEnd: '07:00', emergencyBypassQuietHours: true }]));

    return NextResponse.json({
      success: true,
      data: { tenant, branding, notificationPreferences: notifPrefs },
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

    // Update tenant profile
    if (body.tenant) {
      const tenantUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (body.tenant.name !== undefined) tenantUpdate.name = body.tenant.name;
      if (body.tenant.timezone !== undefined) tenantUpdate.timezone = body.tenant.timezone;
      if (body.tenant.locale !== undefined) tenantUpdate.locale = body.tenant.locale;
      if (Object.keys(tenantUpdate).length > 1) {
        await db.update(tenants).set(tenantUpdate).where(eq(tenants.id, session.tenantId));
      }
    }

    // Update branding
    if (body.branding) {
      const brandingUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (body.branding.contactEmail !== undefined) brandingUpdate.contactEmail = body.branding.contactEmail;
      if (body.branding.contactPhone !== undefined) brandingUpdate.contactPhone = body.branding.contactPhone;
      if (body.branding.address !== undefined) brandingUpdate.address = body.branding.address;
      if (body.branding.primaryColor !== undefined) brandingUpdate.primaryColor = body.branding.primaryColor;
      if (body.branding.accentColor !== undefined) brandingUpdate.accentColor = body.branding.accentColor;
      if (body.branding.documentFooter !== undefined) brandingUpdate.documentFooter = body.branding.documentFooter;
      if (body.branding.senderName !== undefined) brandingUpdate.senderName = body.branding.senderName;
      if (body.branding.senderEmail !== undefined) brandingUpdate.senderEmail = body.branding.senderEmail;

      const [existingBranding] = await db
        .select()
        .from(tenantBranding)
        .where(eq(tenantBranding.tenantId, session.tenantId))
        .limit(1);

      if (existingBranding) {
        await db
          .update(tenantBranding)
          .set(brandingUpdate)
          .where(eq(tenantBranding.tenantId, session.tenantId));
      } else {
        await db
          .insert(tenantBranding)
          .values({ tenantId: session.tenantId, ...brandingUpdate } as typeof tenantBranding.$inferInsert);
      }
    }

    // Update notification preferences
    if (body.notificationPreferences) {
      const prefs = body.notificationPreferences;
      const prefUpdate: Record<string, unknown> = { updatedAt: new Date() };
      if (prefs.emailNotifications !== undefined) prefUpdate.emailNotifications = prefs.emailNotifications;
      if (prefs.inAppNotifications !== undefined) prefUpdate.inAppNotifications = prefs.inAppNotifications;
      if (prefs.quietHoursStart !== undefined) prefUpdate.quietHoursStart = prefs.quietHoursStart;
      if (prefs.quietHoursEnd !== undefined) prefUpdate.quietHoursEnd = prefs.quietHoursEnd;
      if (prefs.emergencyBypassQuietHours !== undefined) prefUpdate.emergencyBypassQuietHours = prefs.emergencyBypassQuietHours;

      const [existingPrefs] = await db
        .select()
        .from(notificationPreferences)
        .where(
          and(
            eq(notificationPreferences.tenantId, session.tenantId),
            eq(notificationPreferences.userId, session.user.id),
          ),
        )
        .limit(1);

      if (existingPrefs) {
        await db
          .update(notificationPreferences)
          .set(prefUpdate)
          .where(eq(notificationPreferences.id, existingPrefs.id));
      } else {
        await db
          .insert(notificationPreferences)
          .values({
            tenantId: session.tenantId,
            userId: session.user.id,
            ...prefUpdate,
          } as typeof notificationPreferences.$inferInsert);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Settings] POST failed:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
