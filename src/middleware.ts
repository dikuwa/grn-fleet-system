import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Public routes that don't require authentication.
 * Auth API routes handle their own session validation.
 */
const publicRoutes = [
  '/login',
  '/api/auth',       // Better Auth handles auth internally
  '/_next/static',
  '/_next/image',
  '/favicon.ico',
  '/manifest.json',
  '/sw.js',
  '/images',
  '/staff-import-template.csv',
  '/vehicle-import-template.csv',
  '/office-import-template.csv',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  const isPublic = publicRoutes.some(
    (route) => pathname === route || pathname.startsWith(route + '/'),
  );
  if (isPublic) return NextResponse.next();

  // Allow API routes (they validate auth internally via getServerSession)
  if (pathname.startsWith('/api/')) return NextResponse.next();

  // For dashboard routes, check for session cookie
  // (Better Auth sets "better-auth.session_token" on login)
  const sessionCookie = request.cookies.get('better-auth.session_token');
  if (!sessionCookie) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all routes except Next.js internals and static files
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js).*)',
  ],
};
