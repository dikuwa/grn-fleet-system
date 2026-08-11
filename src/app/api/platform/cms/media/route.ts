import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';
import { requirePermission, requireRequestAuth } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';
import { buildKey, deleteFile, isStorageConfigured, uploadFile } from '@/lib/storage';

export const runtime = 'nodejs';

const MAX_SIZE = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PREFIX = 'platform/cms';

async function requireSiteManager(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return { error: auth.error } as const;
  const permission = await requirePermission(auth.session, Permissions.SITE_MANAGE);
  if (permission instanceof NextResponse) return { error: permission } as const;
  return { session: auth.session } as const;
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireSiteManager(request);
    if ('error' in auth) return auth.error;
    if (!isStorageConfigured()) return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 });

    const form = await request.formData();
    const file = form.get('file') as File | null;
    const kind = form.get('kind') === 'favicon' ? 'favicon' : 'logo';
    if (!file || !ALLOWED_TYPES.has(file.type)) return NextResponse.json({ error: 'Choose a PNG, JPEG or WebP image.' }, { status: 415 });
    if (file.size > MAX_SIZE) return NextResponse.json({ error: 'Image must be 3 MB or smaller.' }, { status: 413 });

    const source = Buffer.from(await file.arrayBuffer());
    const metadata = await sharp(source).metadata();
    if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) return NextResponse.json({ error: 'The selected file is not a valid image.' }, { status: 415 });
    const image = kind === 'favicon'
      ? await sharp(source).rotate().resize(128, 128, { fit: 'contain' }).png().toBuffer()
      : await sharp(source).rotate().resize(1400, 700, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    const extension = kind === 'favicon' ? 'png' : 'webp';
    const key = buildKey(`${kind}.${extension}`, kind, PREFIX);
    const uploaded = await uploadFile(image, key, { contentType: `image/${extension}`, tenantPrefix: PREFIX, isPublic: true });
    return NextResponse.json({ success: true, data: { key: uploaded.key, url: uploaded.publicUrl } }, { status: 201 });
  } catch (error) {
    console.error('[Platform CMS media] upload failed:', error);
    return NextResponse.json({ error: 'Image upload failed.' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireSiteManager(request);
  if ('error' in auth) return auth.error;
  const { key } = await request.json().catch(() => ({ key: '' }));
  if (typeof key !== 'string' || !key.startsWith(`${PREFIX}/`)) return NextResponse.json({ error: 'Invalid CMS media key.' }, { status: 400 });
  await deleteFile(key);
  return NextResponse.json({ success: true });
}
