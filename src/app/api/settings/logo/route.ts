import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { tenantBranding } from '@/db/schema/tenants';
import { auditEvents } from '@/db/schema/audit';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { buildKey, deleteFile, downloadFile, isStorageConfigured, uploadFile } from '@/lib/storage';

export const runtime = 'nodejs';

const MAX_LOGO_SIZE = 3 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

function tenantLogoKey(value: string, tenantId: string) {
  const prefix = `tenant/${tenantId}/branding/`;
  return value.startsWith(prefix) ? value : null;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 });
  }

  const db = getDb();
  const [branding] = await db
    .select({ logoUrl: tenantBranding.logoUrl })
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, session.tenantId))
    .limit(1);
  const key = branding?.logoUrl && tenantLogoKey(branding.logoUrl, session.tenantId);
  if (!key) return NextResponse.json({ error: 'Tenant logo not found.' }, { status: 404 });

  const file = await downloadFile(key);
  if (!file?.body) return NextResponse.json({ error: 'Tenant logo not found.' }, { status: 404 });
  return new NextResponse(file.body, {
    headers: {
      'Content-Type': file.contentType,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured. Contact your platform administrator.' },
        { status: 503 },
      );
    }

    const form = await request.formData();
    const file = form.get('file') as File | null;
    if (!file) return NextResponse.json({ error: 'Choose a logo image.' }, { status: 400 });
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Logo must be a PNG, JPEG, or WebP image.' },
        { status: 415 },
      );
    }
    if (file.size > MAX_LOGO_SIZE) {
      return NextResponse.json({ error: 'Logo exceeds the 3 MB upload limit.' }, { status: 413 });
    }

    let image: Buffer;
    try {
      const source = Buffer.from(await file.arrayBuffer());
      const metadata = await sharp(source).metadata();
      if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
        throw new Error('Unsupported encoding');
      }
      image = await sharp(source)
        .rotate()
        .resize(1200, 600, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 88 })
        .toBuffer();
    } catch {
      return NextResponse.json(
        { error: 'The selected file is not a valid image.' },
        { status: 415 },
      );
    }

    const db = getDb();
    const [current] = await db
      .select({ id: tenantBranding.id, logoUrl: tenantBranding.logoUrl })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, session.tenantId))
      .limit(1);
    const key = buildKey(
      `tenant-logo-${Date.now()}.webp`,
      'branding',
      `tenant/${session.tenantId}`,
    );
    const uploaded = await uploadFile(image, key, {
      contentType: 'image/webp',
      tenantPrefix: `tenant/${session.tenantId}`,
      isPublic: false,
    });

    if (current) {
      await db
        .update(tenantBranding)
        .set({ logoUrl: uploaded.key, updatedAt: new Date() })
        .where(eq(tenantBranding.id, current.id));
    } else {
      await db.insert(tenantBranding).values({
        tenantId: session.tenantId,
        logoUrl: uploaded.key,
      });
    }
    const previousKey = current?.logoUrl && tenantLogoKey(current.logoUrl, session.tenantId);
    if (previousKey && previousKey !== uploaded.key) {
      await deleteFile(previousKey).catch(() => {});
    }
    await db.insert(auditEvents).values({
      tenantId: session.tenantId,
      tenantSequence: Date.now(),
      eventType: 'tenant_logo_updated',
      actorUserId: session.user.id,
      action: 'update',
      entityType: 'tenant_branding',
      entityId: current?.id || session.tenantId,
      before: { logoConfigured: Boolean(current?.logoUrl) },
      after: { logoConfigured: true },
      sourceChannel: 'web',
    });

    return NextResponse.json({
      success: true,
      data: { logoUrl: `/api/settings/logo?v=${Date.now()}` },
    });
  } catch (error) {
    console.error('[Settings Logo] POST failed:', error);
    return NextResponse.json({ error: 'Failed to upload tenant logo.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;
    const permission = await requirePermission(session, Permissions.TENANT_MANAGE);
    if (permission instanceof NextResponse) return permission;

    const db = getDb();
    const [current] = await db
      .select({ id: tenantBranding.id, logoUrl: tenantBranding.logoUrl })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, session.tenantId))
      .limit(1);
    if (current) {
      await db
        .update(tenantBranding)
        .set({ logoUrl: null, updatedAt: new Date() })
        .where(eq(tenantBranding.id, current.id));
      const key = current.logoUrl && tenantLogoKey(current.logoUrl, session.tenantId);
      if (key) await deleteFile(key).catch(() => {});
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'tenant_logo_removed',
        actorUserId: session.user.id,
        action: 'remove',
        entityType: 'tenant_branding',
        entityId: current.id,
        before: { logoConfigured: Boolean(current.logoUrl) },
        after: { logoConfigured: false },
        sourceChannel: 'web',
      });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Settings Logo] DELETE failed:', error);
    return NextResponse.json({ error: 'Failed to remove tenant logo.' }, { status: 500 });
  }
}
