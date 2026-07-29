import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { userProfiles } from '@/db/schema/auth';
import { auditEvents } from '@/db/schema/audit';
import { requireRequestAuth } from '@/lib/auth-helpers';
import {
  buildKey,
  deleteFile,
  getSignedFileUrl,
  isStorageConfigured,
  uploadFile,
} from '@/lib/storage';

async function getProfile(userId: string) {
  const db = getDb();
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  return profile;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const profile = await getProfile(auth.session.user.id);
  const previewUrl =
    profile?.signatureRef && isStorageConfigured()
      ? await getSignedFileUrl(profile.signatureRef, 600)
      : null;
  return NextResponse.json({
    success: true,
    data: {
      type: profile?.signatureType || null,
      typedName: profile?.signatureTypedName || null,
      confirmedAt: profile?.signatureConfirmedAt || null,
      previewUrl,
    },
  });
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const db = getDb();
  const existing = await getProfile(session.user.id);
  const contentType = request.headers.get('content-type') || '';
  let signatureType: 'typed' | 'uploaded' | 'drawn';
  let signatureRef: string | null = existing?.signatureRef || null;
  let signatureTypedName: string | null = null;

  if (contentType.includes('multipart/form-data')) {
    if (!isStorageConfigured()) {
      return NextResponse.json(
        { error: 'Protected signature storage is unavailable.' },
        { status: 503 },
      );
    }
    const form = await request.formData();
    const file = form.get('file');
    signatureType = form.get('type') === 'drawn' ? 'drawn' : 'uploaded';
    if (!(file instanceof File) || file.type !== 'image/png' || file.size > 1024 * 1024) {
      return NextResponse.json(
        { error: 'Signatures must be a transparent PNG no larger than 1 MB.' },
        { status: 400 },
      );
    }
    const key = buildKey(
      `${session.user.id}-signature.png`,
      'signatures',
      `tenant/${session.tenantId}`,
    );
    await uploadFile(Buffer.from(await file.arrayBuffer()), key, {
      contentType: 'image/png',
      tenantPrefix: `tenant/${session.tenantId}`,
      isPublic: false,
    });
    signatureRef = key;
  } else {
    const body = await request.json();
    signatureType = 'typed';
    signatureTypedName = String(body.typedName || '').trim();
    if (signatureTypedName.length < 2 || signatureTypedName.length > 100) {
      return NextResponse.json(
        { error: 'Enter the name that should appear in the signature.' },
        { status: 400 },
      );
    }
  }

  const values = {
    signatureType,
    signatureRef: signatureType === 'typed' ? null : signatureRef,
    signatureTypedName,
    signatureConfirmedAt: new Date(),
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(userProfiles).set(values).where(eq(userProfiles.userId, session.user.id));
  } else {
    await db.insert(userProfiles).values({
      id: session.user.id,
      userId: session.user.id,
      ...values,
    });
  }
  if (
    existing?.signatureRef &&
    (signatureType === 'typed' || existing.signatureRef !== signatureRef)
  ) {
    await deleteFile(existing.signatureRef).catch(() => undefined);
  }
  await db.insert(auditEvents).values({
    tenantId: session.tenantId,
    tenantSequence: Date.now(),
    eventType: 'signature_profile_updated',
    actorUserId: session.user.id,
    action: 'update_signature',
    entityType: 'profile',
    summary: `Signature profile confirmed as ${signatureType}`,
    sourceChannel: 'web',
  });
  return NextResponse.json({ success: true });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRequestAuth(request);
  if (!auth.ok) return auth.error;
  const { session } = auth;
  const db = getDb();
  const existing = await getProfile(session.user.id);
  if (existing?.signatureRef) await deleteFile(existing.signatureRef).catch(() => undefined);
  await db
    .update(userProfiles)
    .set({
      signatureType: null,
      signatureRef: null,
      signatureTypedName: null,
      signatureConfirmedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(userProfiles.userId, session.user.id));
  await db.insert(auditEvents).values({
    tenantId: session.tenantId,
    tenantSequence: Date.now(),
    eventType: 'signature_profile_removed',
    actorUserId: session.user.id,
    action: 'remove_signature',
    entityType: 'profile',
    summary: 'Signature profile removed by its owner',
    sourceChannel: 'web',
  });
  return NextResponse.json({ success: true });
}
