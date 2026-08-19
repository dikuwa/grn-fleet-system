/**
 * Custom Sign-In API
 *
 * Accepts username/email + password and creates the global Better Auth session.
 * Tenant context is selected separately when the identity belongs to more than
 * one organisation; a single eligible tenant is selected automatically.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user, account, session } from '@/db/schema/better-auth';
import { userProfiles } from '@/db/schema/auth';
import { eq, or, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { rateLimit } from '@/lib/rate-limit';
import { ACTIVE_TENANT_COOKIE, getUserTenantChoices } from '@/lib/session';

const SIGN_IN_SERVICE_UNAVAILABLE = 'Service temporarily unavailable. Please try again later.';
const SESSION_SECONDS = 7 * 24 * 60 * 60;
const TENANT_COOKIE_SECONDS = 30 * 24 * 60 * 60;

function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set('better-auth.session_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

function setTenantCookie(response: NextResponse, tenantId: string) {
  response.cookies.set(ACTIVE_TENANT_COOKIE, tenantId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: TENANT_COOKIE_SECONDS,
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { username, password } = body;

    if (typeof username !== 'string' || !username.trim()) {
      return NextResponse.json({ error: 'Username or email is required' }, { status: 400 });
    }
    if (typeof password !== 'string' || !password.trim()) {
      return NextResponse.json({ error: 'Password is required' }, { status: 400 });
    }

    const normalizedUsername = username.trim().toLowerCase();
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (process.env.NODE_ENV !== 'test' && !process.env.CI) {
      const rl = await rateLimit(`login:${ip}:${normalizedUsername}`, 20, 60);
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
    const [userRecord] = await db
      .select()
      .from(user)
      .where(or(eq(user.username, normalizedUsername), eq(user.email, normalizedUsername))!)
      .limit(1);

    if (!userRecord) {
      return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
    }

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

    const [profile, tenantChoices] = await Promise.all([
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userRecord.id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
      getUserTenantChoices(userRecord.id),
    ]);

    if (tenantChoices.length === 0) {
      return NextResponse.json(
        { error: 'No active organisation access is available for this account.' },
        { status: 403 },
      );
    }

    const requiresPasswordChange = profile?.requiresPasswordChange ?? false;
    const { v4: uuid } = await import('uuid');
    const token = uuid();
    const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);

    await db.insert(session).values({
      id: token,
      token,
      userId: userRecord.id,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await db
      .update(userProfiles)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(userProfiles.userId, userRecord.id));

    const requiresTenantSelection = tenantChoices.length > 1;
    const response = NextResponse.json({
      redirect: requiresPasswordChange,
      redirectTo: requiresPasswordChange ? '/dashboard/profile' : null,
      requiresPasswordChange,
      requiresTenantSelection,
      tenantChoices: tenantChoices.map(({ id, name, slug }) => ({ id, name, slug })),
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

    setSessionCookie(response, token, expiresAt);
    if (!requiresTenantSelection) setTenantCookie(response, tenantChoices[0]!.id);

    if (!requiresTenantSelection) {
      try {
        const { auditEvents } = await import('@/db/schema/audit');
        await db.insert(auditEvents).values({
          tenantId: tenantChoices[0]!.id,
          tenantSequence: Date.now(),
          eventType: 'user_login',
          actorUserId: userRecord.id,
          action: 'login',
          entityType: 'user',
          entityId: userRecord.id,
          summary: `User signed in via ${normalizedUsername.includes('@') ? 'email' : 'username'}`,
        });
      } catch {
        // Non-fatal audit error
      }
    }

    return response;
  } catch (error) {
    console.error('[Custom Sign-In] Failed:', error);
    return NextResponse.json({ error: SIGN_IN_SERVICE_UNAVAILABLE }, { status: 503 });
  }
}
