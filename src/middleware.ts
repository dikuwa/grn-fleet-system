import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Next.js middleware — server-side auth gate for all non-public routes.
 *
 * Strategy: cookie-based session check (edge-compatible, no Node.js APIs).
 * Better Auth sets `better-auth.session_token` on login.
 * If the cookie is missing, redirect to /login with a redirect param.
 *
 * API routes are NOT blocked here — they validate auth internally
 * via getServerSession() / better-auth helpers.
 */

const SESSION_COOKIE = 'better-auth.session_token';

/**
 * Routes that never require authentication.
 */
const publicRoutes: string[] = [
  '/login',
  '/api/auth',
];

/**
 * Static asset prefixes — always pass through.
 */
const staticPrefixes: string[] = [
  '/_next',
  '/favicon.ico',
  '/images',
  '/staff-import-template.csv',
  '/vehicle-import-template.csv',
  '/office-import-template.csv',
];

function isPublicOrStatic(pathname: string): boolean {
  // Exact or prefix match on public routes
  if (publicRoutes.some(r => pathname === r || pathname.startsWith(r + '/'))) {
    return true;
  }
  // Static asset prefixes
  if (staticPrefixes.some(p => pathname.startsWith(p))) {
    return true;
  }
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Skip public routes, static assets, manifest, service worker
  if (
    isPublicOrStatic(pathname) ||
    pathname === '/manifest.json' ||
    pathname === '/sw.js'
  ) {
    return NextResponse.next();
  }

  // API routes handle auth internally — pass through
  if (pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get(SESSION_COOKIE);
  if (!sessionCookie?.value) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Cookie exists — allow through.
  // (Full session validation is done server-side in layouts/APIs via getServerSession)
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw\\.js).*)',
  ],
};
