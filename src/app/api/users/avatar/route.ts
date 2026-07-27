import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { downloadFile, isStorageConfigured } from '@/lib/storage';

function storedAvatarKey(value: string, tenantId: string): string | null {
  const expectedPrefix = `tenant/${tenantId}/avatars/`;
  if (value.startsWith(expectedPrefix)) return value;

  try {
    const url = new URL(value);
    const path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const prefixIndex = path.indexOf(expectedPrefix);
    return prefixIndex >= 0 ? path.slice(prefixIndex) : null;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;

  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 });
  }

  const db = getDb();
  const [record] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, session.user.id))
    .limit(1);

  if (!record?.image) {
    return NextResponse.json({ error: 'Profile image not found.' }, { status: 404 });
  }

  const key = storedAvatarKey(record.image, session.tenantId);
  if (!key) {
    return NextResponse.json({ error: 'Profile image reference is invalid.' }, { status: 404 });
  }

  const file = await downloadFile(key);
  if (!file?.body) {
    return NextResponse.json({ error: 'Profile image not found.' }, { status: 404 });
  }

  const headers = new Headers({
    'Content-Type': file.contentType,
    'Cache-Control': 'private, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  if (file.contentLength !== undefined) {
    headers.set('Content-Length', String(file.contentLength));
  }

  return new NextResponse(file.body, { headers });
}
