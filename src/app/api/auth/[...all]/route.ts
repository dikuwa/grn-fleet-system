/**
 * Auth API Route Handler
 *
 * Handles sign-in, session, and sign-out using Drizzle directly.
 * Compatible with the `better-auth/react` client library.
 *
 * The Better Auth v1.6.x client sends requests to:
 *   - POST /api/auth/sign-in/email  → sign-in (not /sign-in)
 *   - GET  /api/auth/get-session    → session info (not /session)
 *   - POST /api/auth/sign-out       → sign-out
 *
 * This handler matches those paths AND the shorter fallback paths.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/db';
import { user, account, session } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { parseCookies } from '@/lib/utils';
import { rateLimit } from '@/lib/rate-limit';

function getPathname(request: NextRequest): string {
  return new URL(request.url).pathname;
}

function errorResponse(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// ---------------------------------------------------------------------------
// POST /api/auth/sign-in/email  (Better Auth client sends to /sign-in/email)
// ---------------------------------------------------------------------------
async function handleSignIn(request: NextRequest) {
  try {
    // Rate limit: 5 sign-in attempts per IP per 60 seconds
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const body = await request.json();
    const { email, password } = body;

    if (email) {
      const rl = await rateLimit(`login:${ip}:${email}`, 5, 60);
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

    // Find user by email
    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.email, email))
      .limit(1);

    if (!userRecord) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 },
      );
    }

    // Find account with password hash (Better Auth uses 'email' providerId)
    const [accountRecord] = await db
      .select()
      .from(account)
      .where(and(
        eq(account.userId, userRecord.id),
        eq(account.providerId, 'email'),
      ))
      .limit(1);

    if (!accountRecord?.password) {
      return NextResponse.json(
        { error: 'No password set for this account' },
        { status: 401 },
      );
    }

    // Verify password
    const isValid = await bcrypt.compare(password, accountRecord.password);
    if (!isValid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 },
      );
    }

    // Create session — Better Auth uses the session token as the primary
    // identifier. The `id` column in Better Auth's schema IS the token,
    // but our schema has separate `id` and `token`. We store the token
    // in BOTH fields for compatibility.
    const { v4: uuid } = await import('uuid');
    const token = uuid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(session).values({
      id: token,    // Better Auth convention: session.id = session token
      token,
      userId: userRecord.id,
      expiresAt,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Better Auth's client expects this response format from sign-in:
    // { redirect, token, url, user }
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

    // Set the session cookie (Better Auth uses signed cookies, but
    // the client only checks for the existence of the cookie)
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

// ---------------------------------------------------------------------------
// GET /api/auth/get-session  (Better Auth client sends to /get-session)
// ---------------------------------------------------------------------------
async function handleSession(request: NextRequest) {
  try {
    // Rate limit: 30 session checks per IP per 60 seconds
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rl = await rateLimit(`session:${ip}`, 30, 60);
    if (!rl.success) {
      console.warn('[Auth] Rate limit exceeded for session checks', { ip });
      return NextResponse.json({ session: null, user: null });
    }

    const db = getDb();
    const cookies = parseCookies(request.headers.get('cookie'));
    const token = cookies['better-auth.session_token'];

    if (!token) {
      return NextResponse.json({ session: null, user: null });
    }

    // Find session by token
    const [sessionRecord] = await db
      .select()
      .from(session)
      .where(eq(session.token, token))
      .limit(1);

    if (!sessionRecord || new Date(sessionRecord.expiresAt) < new Date()) {
      return NextResponse.json({ session: null, user: null });
    }

    // Find user
    const [userRecord] = await db
      .select()
      .from(user)
      .where(eq(user.id, sessionRecord.userId))
      .limit(1);

    if (!userRecord) {
      return NextResponse.json({ session: null, user: null });
    }

    // Better Auth client expects: { session: { id, expiresAt, userId, ... }, user: { ... } }
    // Note: session.id is the token in Better Auth's convention
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
        id: sessionRecord.token,  // Better Auth expects id = token
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

// ---------------------------------------------------------------------------
// POST /api/auth/sign-out
// ---------------------------------------------------------------------------
async function handleSignOut(request: NextRequest) {
  try {
    const db = getDb();
    const cookies = parseCookies(request.headers.get('cookie'));
    const token = cookies['better-auth.session_token'];

    if (token) {
      await db.delete(session).where(eq(session.token, token));
    }

    const response = NextResponse.json({ success: true });
    response.cookies.set('better-auth.session_token', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });

    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Auth] Sign-out error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// Router — matches Better Auth v1.6.x client paths
// ---------------------------------------------------------------------------

function route(request: NextRequest): Promise<NextResponse> {
  const pathname = getPathname(request).replace(/\/$/, '');
  const method = request.method;

  // Sign-in: Better Auth client sends POST /api/auth/sign-in/email
  if (
    method === 'POST' &&
    (pathname === '/api/auth/sign-in' ||
     pathname === '/api/auth/sign-in/email' ||
     pathname === '/api/auth/sign-in/')
  ) {
    return handleSignIn(request);
  }

  // Session: Better Auth client sends GET /api/auth/get-session
  if (
    method === 'GET' &&
    (pathname === '/api/auth/session' ||
     pathname === '/api/auth/get-session' ||
     pathname === '/api/auth/user')
  ) {
    return handleSession(request);
  }

  // Sign-out: Better Auth client sends POST /api/auth/sign-out
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
