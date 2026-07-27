/**
 * User Avatar Upload API
 *
 * POST   /api/users/upload-avatar  — Upload a profile photo
 * DELETE /api/users/upload-avatar  — Remove the profile photo
 *
 * Supported formats: JPEG, PNG, WebP
 * Max size: 2 MB
 * Cache invalidation: versioned URL via timestamp query parameter
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { uploadFile, buildKey, isStorageConfigured, deleteFile } from '@/lib/storage';

const MAX_AVATAR_SIZE = 2 * 1024 * 1024; // 2 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured. Contact your administrator.' },
        { status: 503 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    // Validate MIME type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: 'Unsupported format. Only JPEG, PNG, and WebP images are allowed.' },
        { status: 415 },
      );
    }

    // Validate file size
    if (file.size > MAX_AVATAR_SIZE) {
      return NextResponse.json(
        { error: 'Image too large. Maximum size is 2 MB.' },
        { status: 413 },
      );
    }

    const db = getDb();

    // Get current avatar to clean up later
    const [currentUser] = await db
      .select({ image: user.image })
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    const oldImageValue = currentUser?.image || null;

    // Decode the file instead of trusting the browser-provided MIME type,
    // then normalise it to a small, display-safe WebP avatar.
    const sourceBuffer = Buffer.from(await file.arrayBuffer());
    let buffer: Buffer;
    try {
      const metadata = await sharp(sourceBuffer).metadata();
      if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
        throw new Error('Unsupported image encoding');
      }
      buffer = await sharp(sourceBuffer)
        .rotate()
        .resize(512, 512, { fit: 'cover', position: 'centre', withoutEnlargement: true })
        .webp({ quality: 84 })
        .toBuffer();
    } catch {
      return NextResponse.json(
        { error: 'The uploaded file is not a valid JPEG, PNG, or WebP image.' },
        { status: 415 },
      );
    }

    // Build a versioned key so CDN/browser caches are invalidated on each upload
    const version = Date.now();
    const filename = `avatar-${session.user.id}-v${version}.webp`;
    const key = buildKey(filename, 'avatars', `tenant/${session.tenantId}`);

    // Upload new avatar
    const result = await uploadFile(buffer, key, {
      contentType: 'image/webp',
      tenantPrefix: `tenant/${session.tenantId}`,
      isPublic: false,
    });

    // Update user record — only after successful upload
    await db
      .update(user)
      .set({ image: result.key, updatedAt: new Date(version) })
      .where(eq(user.id, session.user.id));

    // Clean up old avatar — only after new one is saved successfully
    if (oldImageValue && isStorageConfigured()) {
      try {
        const prefix = `tenant/${session.tenantId}/avatars/`;
        let oldKey = oldImageValue.startsWith(prefix) ? oldImageValue : null;
        if (!oldKey) {
          const cleanUrl = oldImageValue.split('?')[0];
          const prefixIndex = cleanUrl.indexOf(prefix);
          if (prefixIndex >= 0) oldKey = cleanUrl.slice(prefixIndex);
        }
        if (oldKey && oldKey !== result.key) {
          await deleteFile(oldKey).catch(() => {});
        }
      } catch {
        // Non-fatal cleanup error
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        imageUrl: `/api/users/avatar?v=${version}`,
        version,
      },
    });
  } catch (error) {
    console.error('[Avatar Upload] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to upload avatar. Please try again.' },
      { status: 500 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const db = getDb();

    // Get current user's image
    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.id, session.user.id))
      .limit(1);

    // Remove image from storage
    if (userRecord?.image && isStorageConfigured()) {
      try {
        const prefix = `tenant/${session.tenantId}/avatars/`;
        const cleanValue = userRecord.image.split('?')[0];
        const prefixIndex = cleanValue.indexOf(prefix);
        const key = cleanValue.startsWith(prefix)
          ? cleanValue
          : prefixIndex >= 0
            ? cleanValue.slice(prefixIndex)
            : null;
        if (key) await deleteFile(key);
      } catch {
        // Non-fatal
      }
    }

    // Clear image field in database
    await db
      .update(user)
      .set({ image: null, updatedAt: new Date() })
      .where(eq(user.id, session.user.id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Avatar Delete] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to remove avatar' },
      { status: 500 },
    );
  }
}
