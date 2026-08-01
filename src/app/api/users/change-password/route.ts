/**
 * Change Password API
 *
 * POST /api/users/change-password  — Change current user's password
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { account } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { auditEvents } from '@/db/schema/audit';
import { eq, and } from 'drizzle-orm';
import { requireRequestAuth } from '@/lib/auth-helpers';

import bcrypt from 'bcryptjs';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireRequestAuth(request);
    if (!auth.ok) return auth.error;
    const { session } = auth;

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword?.trim()) {
      return NextResponse.json({ error: 'Current password is required' }, { status: 400 });
    }
    if (!newPassword?.trim() || newPassword.length < 6) {
      return NextResponse.json({ error: 'New password is required (min 6 characters)' }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: 'New password must be different from current password' }, { status: 400 });
    }

    const db = getDb();

    // Verify current password
    const [acct] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, session.user.id), eq(account.providerId, 'email')))
      .limit(1);

    if (!acct?.password) {
      return NextResponse.json({ error: 'No password account found' }, { status: 400 });
    }

    const isValid = await bcrypt.compare(currentPassword, acct.password);
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 403 });
    }

    // Update password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await db
      .update(account)
      .set({ password: passwordHash, updatedAt: new Date() })
      .where(eq(account.id, acct.id));

    // Update requiresPasswordChange flag - upsert pattern
    const [existingProfile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, session.user.id))
      .limit(1);

    if (existingProfile) {
      await db
        .update(userProfiles)
        .set({ requiresPasswordChange: false, updatedAt: new Date() })
        .where(eq(userProfiles.userId, session.user.id));
    } else {
      await db.insert(userProfiles).values({
        id: session.user.id,
        userId: session.user.id,
        requiresPasswordChange: false,
        status: 'active',
      });
    }

    // Log audit event
    try {
      await db.insert(auditEvents).values({
        tenantId: session.tenantId,
        tenantSequence: Date.now(),
        eventType: 'password_changed',
        actorUserId: session.user.id,
        action: 'change_password',
        entityType: 'user',
        entityId: session.user.id,
        summary: 'User changed their own password',
      });
    } catch {
      // Non-fatal
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Change Password] POST failed:', error);
    return NextResponse.json(
      { error: 'Failed to change password: ' + String(error) },
      { status: 500 },
    );
  }
}
