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
import { requireRequestAuth } from '@/lib/auth-helpers';
import { UPLOAD_MAX_SIZE_BYTES, ALLOWED_IMAGE_TYPES } from '@/lib/constants';
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

    const oldImageKey = currentUser?.image || null;

    // Determine extension from MIME type
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
    };
    const ext = extMap[file.type] || 'jpg';

    // Build a versioned key so CDN/browser caches are invalidated on each upload
    const version = Date.now();
    const filename = `avatar-${session.user.id}-v${version}.${ext}`;
    const key = buildKey(filename, 'avatars', `tenant/${session.tenantId}`);

    // Read file buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Upload new avatar
    const result = await uploadFile(buffer, key, {
      contentType: file.type,
      tenantPrefix: `tenant/${session.tenantId}`,
      isPublic: true,
    });

    if (!result.publicUrl) {
      throw new Error('Upload completed but no public URL was returned');
    }

    // Add a cache-busting query parameter to the URL
    const imageUrl = `${result.publicUrl}?v=${version}`;

    // Update user record — only after successful upload
    await db
      .update(user)
      .set({ image: imageUrl, updatedAt: new Date() })
      .where(eq(user.id, session.user.id));

    // Clean up old avatar — only after new one is saved successfully
    if (oldImageKey && isStorageConfigured()) {
      try {
        // Extract the old key from the URL
        const oldUrl = oldImageKey.split('?')[0]; // Remove cache buster
        const urlParts = oldUrl.split('/');
        const oldFilename = urlParts[urlParts.length - 1];

        // Only delete if it looks like an avatar (not a default/placeholder)
        if (oldFilename && oldFilename.includes('avatar-') && !oldFilename.includes('default')) {
          // Try to resolve the old key
          const oldKey = `tenant/${session.tenantId}/avatars/${oldFilename}`;
          await deleteFile(oldKey).catch(() => {
            // Non-fatal — old file may have been deleted already
          });
        }
      } catch {
        // Non-fatal cleanup error
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        imageUrl,
        key: result.key,
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
        const cleanUrl = userRecord.image.split('?')[0]; // Remove cache buster
        const urlParts = cleanUrl.split('/');
        const fileName = urlParts[urlParts.length - 1];
        if (fileName && fileName.includes('avatar-')) {
          const fileKey = `tenant/${session.tenantId}/avatars/${fileName}`;
          await deleteFile(fileKey);
        }
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
