/**
 * Custom Sign-In API
 *
 * POST /api/auth/custom-sign-in
 *
 * Accepts username or email and password.
 * If username is provided, resolves it to the user's email,
 * then creates a session using the same logic as the built-in auth handler.
 *
 * This enables username-based login while maintaining full compatibility
 * with the existing session management in /api/auth/[...all].
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user, account, session } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { auditEvents } from '@/db/schema/audit';
import { eq, or, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { rateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (!username?.trim()) {
      return NextResponse.json({ error: 'Username or email is required' }, { status: 400 });
    }
    if (!password?.trim()) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    // Rate limit: 5 sign-in attempts per IP per 60 seconds
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (process.env.NODE_ENV !== 'test' && !process.env.CI) {
      const rl = await rateLimit(`login:${ip}:${username}`, 20, 60);
      if (!rl.success) {
        const res = NextResponse.json(
          { error: 'Too many sign-in attempts. Please try again later.' },
          { status: 429 },
        );
        Object.entries(rl.headers).forEach(([key, value]) => res.headers.set(key, value));
        return res;
      }
    }

    const db = getDb();

    // Find user by username or email
    const [userRecord] = await db
      .select()
      .from(user)
      .where(
        or(
          eq(user.username, username.trim().toLowerCase()),
          eq(user.email, username.trim().toLowerCase()),
        )!,
      )
      .limit(1);

    if (!userRecord) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // Find account with password hash
    const [acct] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, userRecord.id), eq(account.providerId, 'email')))
      .limit(1);

    if (!acct?.password) {
      return NextResponse.json({ error: 'No password set for this account' }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, acct.password);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

    // Check if password change is required
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userRecord.id))
      .limit(1);

    const requiresPasswordChange = profile?.requiresPasswordChange ?? false;
    if (requiresPasswordChange) {
      // Still create session so user can navigate to change password page
      const { v4: uuid } = await import('uuid');
      const token = uuid();
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      await db.insert(session).values({
        id: token,
        token,
        userId: userRecord.id,
        expiresAt,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const response = NextResponse.json({
        redirect: true,
        redirectTo: '/dashboard/profile',
        requiresPasswordChange: true,
        token,
        user: {
          id: userRecord.id,
          email: userRecord.email,
          emailVerified: userRecord.emailVerified,
          name: userRecord.name,
          image: userRecord.image,
        },
      });

      response.cookies.set('better-auth.session_token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        expires: expiresAt,
      });

      return response;
    }

    // Create session using same pattern as handleSignIn in /api/auth/[...all]
    const { v4: uuid } = await import('uuid');
    const token = uuid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(session).values({
      id: token,
      token,
      userId: userRecord.id,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Update last login timestamp on user profile
    await db
      .update(userProfiles)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(userProfiles.userId, userRecord.id));

    // Log audit event
    try {
      // Find tenant for audit context
      const { tenantMemberships, tenants } = await import('@/db/schema/tenants');
      const [membership] = await db
        .select({ tenantId: tenantMemberships.tenantId })
        .from(tenantMemberships)
        .where(and(eq(tenantMemberships.userId, userRecord.id), eq(tenantMemberships.status, 'active')))
        .limit(1);

      if (membership) {
        const { auditEvents } = await import('@/db/schema/audit');
        await db.insert(auditEvents).values({
          tenantId: membership.tenantId,
          tenantSequence: Date.now(),
          eventType: 'user_login',
          actorUserId: userRecord.id,
          action: 'login',
          entityType: 'user',
          entityId: userRecord.id,
          summary: `User signed in via ${username.includes('@') ? 'email' : 'username'}`,
        });
      }
    } catch {
      // Non-fatal audit error
    }

    // Build response (same format as handleSignIn)
    const response = NextResponse.json({
      redirect: false,
      token,
      url: null,
      user: {
        id: userRecord.id,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        name: userRecord.name,
        image: userRecord.image,
        createdAt: userRecord.createdAt,
        updatedAt: userRecord.updatedAt,
      },
    });

    // Set the session cookie
    response.cookies.set('better-auth.session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

    return response;
  } catch (error) {
    console.error('[Custom Sign-In] Failed:', error);
    return NextResponse.json(
      { error: 'Sign in failed: ' + (error instanceof Error ? error.message : String(error)) },
      { status: 500 },
    );
  }
}
