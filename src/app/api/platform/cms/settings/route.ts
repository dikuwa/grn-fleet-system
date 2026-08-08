/**
 * Platform Site Settings Admin API
 *
 * GET   /api/platform/cms/settings — Get the site settings row (with the
 *       extended public-site content, or defaults when not yet saved)
 * PATCH /api/platform/cms/settings — Upsert site settings + public content.
 *
 * Both require an authenticated Platform Admin with SITE_MANAGE permission.
 * All public content is sanitised server-side before it is stored.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireRequestAuth, requirePermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { getDb } from '@/db';
import { cmsSiteSettings } from '@/db/schema/cms-content';
import { desc, eq } from 'drizzle-orm';
import {
  PUBLIC_SITE_CONTENT_KEY,
  sanitizePublicSiteContent,
  readStoredPublicSiteContent,
} from '@/lib/platform/site-settings-content';

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const db = getDb();
    const [settings] = await db
      .select()
      .from(cmsSiteSettings)
      .orderBy(desc(cmsSiteSettings.updatedAt))
      .limit(1);

    return NextResponse.json({
      success: true,
      data: {
        settings: settings ?? null,
        publicContent: readStoredPublicSiteContent(settings),
      },
    });
  } catch (error) {
    console.error('[Platform Site Settings] GET failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PATCH — upsert settings + sanitised public content
// ---------------------------------------------------------------------------

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const permCheck = await requirePermission(session, Permissions.SITE_MANAGE);
    if (permCheck instanceof NextResponse) return permCheck;

    const body = await request.json();
    const db = getDb();

    const [existing] = await db
      .select()
      .from(cmsSiteSettings)
      .orderBy(desc(cmsSiteSettings.updatedAt))
      .limit(1);

    // --- Brand + contact columns already present on the table ---
    const brand = (body.brand ?? {}) as Record<string, unknown>;
    const contact = (body.contact ?? {}) as Record<string, unknown>;

    const str = (value: unknown, max: number): string =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : '';
    const strOrNull = (value: unknown, max: number): string | null => {
      const cleaned = str(value, max);
      return cleaned || null;
    };

    const siteName = str(brand.siteName, 120) || existing?.siteName || 'GovFleet Namibia';
    const siteTagline = strOrNull(brand.siteTagline, 200);
    const logoUrl = strOrNull(brand.logoUrl, 400);
    const faviconUrl = strOrNull(brand.faviconUrl, 400);
    const contactEmail = strOrNull(contact.supportEmail, 160);
    const contactPhone = strOrNull(contact.phone, 60);
    const address = strOrNull(contact.address, 240);

    // --- Extended public-site content (sanitised) stored in metadata ---
    const publicContent = sanitizePublicSiteContent(
      (body.publicContent ?? {}) as unknown,
    );
    const metadata: Record<string, unknown> = {
      ...(existing?.metadata ?? {}),
      [PUBLIC_SITE_CONTENT_KEY]: publicContent,
    };

    const now = new Date();

    if (existing) {
      const [updated] = await db
        .update(cmsSiteSettings)
        .set({
          siteName,
          siteTagline,
          logoUrl,
          faviconUrl,
          contactEmail,
          contactPhone,
          address,
          metadata,
          updatedAt: now,
        })
        .where(eq(cmsSiteSettings.id, existing.id))
        .returning();
      return NextResponse.json({ success: true, data: { settings: updated } });
    }

    const [created] = await db
      .insert(cmsSiteSettings)
      .values({
        siteName,
        siteTagline,
        logoUrl,
        faviconUrl,
        contactEmail,
        contactPhone,
        address,
        metadata,
        updatedAt: now,
      })
      .returning();

    return NextResponse.json({ success: true, data: { settings: created } });
  } catch (error) {
    console.error('[Platform Site Settings] PATCH failed:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
