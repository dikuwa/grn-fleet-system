/**
 * Auth API Route Handler
 *
 * Handles sign-in, session, and sign-out using Drizzle directly.
 * Compatible with the `better-auth/react` client library.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user, account, session } from '@/db/schema';
import { userProfiles } from '@/db/schema/auth';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { parseCookies } from '@/lib/utils';
import { rateLimit } from '@/lib/rate-limit';
import { ACTIVE_TENANT_COOKIE } from '@/lib/session';

function getPathname(request: NextRequest): string {
  return new URL(request.url).pathname;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function handleSignIn(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const body = await request.json();
    const { email, password } = body;

    if (email && process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development' && !process.env.CI) {
      const rl = await rateLimit(`login:${ip}:${email}`, 20, 60);
      if (!rl.success) {
        const res = NextResponse.json(
          { error: 'Too many sign-in attempts. Please try again later.' },
          { status: 429 },
        );
        Object.entries(rl.headers).forEach(([key, value]) => res.headers.set(key, value));
        return res;
      }
    }

    if (!email || !password) {
      return errorResponse('Email and password are required');
    }

    const db = getDb();
    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (!userRecord) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    const [[accountRecord], [profile]] = await Promise.all([
      db
        .select()
        .from(account)
        .where(and(eq(account.userId, userRecord.id), eq(account.providerId, 'email')))
        .limit(1),
      db
        .select({ status: userProfiles.status, accountEnabled: userProfiles.accountEnabled })
        .from(userProfiles)
        .where(eq(userProfiles.userId, userRecord.id))
        .limit(1),
    ]);

    if (!accountRecord?.password) {
      return NextResponse.json({ error: 'No password set for this account' }, { status: 401 });
    }

    const isValid = await bcrypt.compare(password, accountRecord.password);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
    }

    if (profile && (!profile.accountEnabled || profile.status !== 'active')) {
      return NextResponse.json(
        { error: 'This account is disabled. Contact an administrator for assistance.' },
        { status: 403 },
      );
    }

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

    response.cookies.set('better-auth.session_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      expires: expiresAt,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Auth] Sign-in error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleSession(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    if (process.env.NODE_ENV !== 'test' && process.env.NODE_ENV !== 'development' && !process.env.CI) {
      const rl = await rateLimit(`session:${ip}`, 30, 60);
      if (!rl.success) {
        console.warn('[Auth] Rate limit exceeded for session checks', { ip });
        return NextResponse.json({ session: null, user: null });
      }
    }

    const db = getDb();
    const cookies = parseCookies(request.headers.get('cookie'));
    const token = cookies['better-auth.session_token'];

    if (!token) {
      return NextResponse.json({ session: null, user: null });
    }

    const [sessionRecord] = await db
      .select()
      .from(session)
      .where(eq(session.token, token))
      .limit(1);

    if (!sessionRecord || new Date(sessionRecord.expiresAt) < new Date()) {
      return NextResponse.json({ session: null, user: null });
    }

    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.id, sessionRecord.userId))
      .limit(1);

    if (!userRecord) {
      return NextResponse.json({ session: null, user: null });
    }

    return NextResponse.json({
      user: {
        id: userRecord.id,
        email: userRecord.email,
        emailVerified: userRecord.emailVerified,
        name: userRecord.name,
        image: userRecord.image,
        createdAt: userRecord.createdAt,
        updatedAt: userRecord.updatedAt,
      },
      session: {
        id: sessionRecord.token,
        token: sessionRecord.token,
        userId: sessionRecord.userId,
        expiresAt: sessionRecord.expiresAt,
        createdAt: sessionRecord.createdAt,
        updatedAt: sessionRecord.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Auth] Session error:', message);
    return NextResponse.json({ session: null, user: null });
  }
}

async function handleSignOut(request: NextRequest) {
  try {
    const db = getDb();
    const cookies = parseCookies(request.headers.get('cookie'));
    const token = cookies['better-auth.session_token'];
    const activeTenantId = cookies[ACTIVE_TENANT_COOKIE];

    if (token) {
      const [sessionRecord] = await db
        .select({ userId: session.userId })
        .from(session)
        .where(eq(session.token, token))
        .limit(1);

      if (sessionRecord && activeTenantId) {
        try {
          const { tenantMemberships } = await import('@/db/schema/tenants');
          const { auditEvents } = await import('@/db/schema/audit');
          const [membership] = await db
            .select({ tenantId: tenantMemberships.tenantId })
            .from(tenantMemberships)
            .where(and(
              eq(tenantMemberships.userId, sessionRecord.userId),
              eq(tenantMemberships.tenantId, activeTenantId),
              eq(tenantMemberships.status, 'active'),
            ))
            .limit(1);

          if (membership) {
            await db.insert(auditEvents).values({
              tenantId: membership.tenantId,
              tenantSequence: Date.now(),
              eventType: 'user_logout',
              actorUserId: sessionRecord.userId,
              action: 'logout',
              entityType: 'user',
              entityId: sessionRecord.userId,
              summary: 'User signed out',
            });
          }
        } catch {
          // Non-fatal audit error.
        }
      }

      await db.delete(session).where(eq(session.token, token));
    }

    const response = NextResponse.json({ success: true });
    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 0,
    };
    response.cookies.set('better-auth.session_token', '', cookieOptions);
    response.cookies.set(ACTIVE_TENANT_COOKIE, '', cookieOptions);

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Auth] Sign-out error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function route(request: NextRequest): Promise<NextResponse> {
  const pathname = getPathname(request).replace(/\/$/, '');
  const method = request.method;

  if (
    method === 'POST' &&
    (pathname === '/api/auth/sign-in' ||
     pathname === '/api/auth/sign-in/email' ||
     pathname === '/api/auth/sign-in/')
  ) {
    return handleSignIn(request);
  }

  if (
    method === 'GET' &&
    (pathname === '/api/auth/session' ||
     pathname === '/api/auth/get-session' ||
     pathname === '/api/auth/user')
  ) {
    return handleSession(request);
  }

  if (method === 'POST' && pathname === '/api/auth/sign-out') {
    return handleSignOut(request);
  }

  return Promise.resolve(errorResponse(`Not found: ${method} ${pathname}`, 404));
}

export const GET = route;
export const POST = route;
export const PATCH = route;
export const PUT = route;
export const DELETE = route;
