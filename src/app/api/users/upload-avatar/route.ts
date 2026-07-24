/**
 * User Avatar Upload API
 *
 * POST /api/users/upload-avatar  — Upload a profile photo for the current user
 * DELETE /api/users/upload-avatar — Remove the profile photo
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user } from '@/db/schema/better-auth';
import { eq } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';
import { UPLOAD_MAX_SIZE_BYTES } from '@/lib/constants';
import { uploadFile, buildKey, isStorageConfigured, deleteFile } from '@/lib/storage';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'File storage is not configured. Set R2 credentials.' },
        { status: 503 },
      );
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Only JPEG, PNG, and WebP images are allowed.' }, { status: 415 });
    }

    if (file.size > 2 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large. Maximum size is 2 MB.' }, { status: 413 });
    }

    const ext = file.name.split('.').pop() || 'jpg';
    const key = buildKey(`avatar-${session.user.id}.${ext}`, 'avatars', `tenant/${session.tenantId}`);
    const buffer = Buffer.from(await file.arrayBuffer());

    const result = await uploadFile(buffer, key, {
      contentType: file.type,
      tenantPrefix: `tenant/${session.tenantId}`,
      isPublic: true,
    });

    // Update user's image field with the public URL
    const db = getDb();
    const imageUrl = result.publicUrl || null;
    await db
      .update(user)
      .set({ image: imageUrl, updatedAt: new Date() })
      .where(eq(user.id, session.user.id));

    return NextResponse.json({
      success: true,
      data: {
        imageUrl,
        key: result.key,
      },
    });
  } catch (error) {
    console.error('[Avatar Upload] Failed:', error);
    return NextResponse.json(
      { error: 'Failed to upload avatar: ' + (error instanceof Error ? error.message : String(error)) },
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

    if (userRecord?.image && isStorageConfigured()) {
      // Try to delete the file from storage
      try {
        const urlParts = userRecord.image.split('/');
        const fileName = urlParts[urlParts.length - 1];
        if (fileName && fileName.includes('avatar-')) {
          const fileKey = `tenant/${session.tenantId}/avatars/${fileName}`;
          await deleteFile(fileKey);
        }
      } catch {
        // Silently ignore deletion errors
      }
    }

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
