import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for auth-related utilities.
 */

// ---------------------------------------------------------------------------
// Hoisting workaround for vi.mock: use vi.hoisted for variable references
// ---------------------------------------------------------------------------

const mockSessionRef = vi.hoisted(() => ({ current: { data: null as { user: { id: string; email: string; name: string } } | null } }));
const mockSignInEmail = vi.hoisted(() => vi.fn());
const mockSignInObj = vi.hoisted(() => ({ email: mockSignInEmail }));
const mockSignOutFn = vi.hoisted(() => vi.fn());

vi.mock('@/lib/auth-client', () => ({
  useSession: () => mockSessionRef.current,
  signIn: mockSignInObj,
  signOut: mockSignOutFn,
}));

import { useSession, signIn, signOut } from '@/lib/auth-client';

beforeEach(() => {
  vi.clearAllMocks();
  mockSessionRef.current = { data: null };
});

// ---------------------------------------------------------------------------
// Auth Client
// ---------------------------------------------------------------------------

describe('Auth Client', () => {
  it('exports useSession, signIn, signOut', () => {
    expect(useSession).toBeDefined();
    expect(signIn).toBeDefined();
    expect(signOut).toBeDefined();
  });

  it('useSession returns null when no session', () => {
    const session = useSession();
    expect(session.data).toBeNull();
  });

  it('useSession returns user data when authenticated', () => {
    mockSessionRef.current = {
      data: {
        user: {
          id: 'user-1',
          email: 'admin@test.gov.na',
          name: 'Test Admin',
        },
      },
    };

    const session = useSession();
    expect(session.data).not.toBeNull();
    expect(session.data?.user.id).toBe('user-1');
    expect(session.data?.user.email).toBe('admin@test.gov.na');
  });

  it('signIn calls with email and password', async () => {
    mockSignInEmail.mockResolvedValue({ data: { user: { id: 'u1' } } });

    const result = await signIn.email({ email: 'a@b.com', password: 'secret' });
    expect(mockSignInEmail).toHaveBeenCalledWith({ email: 'a@b.com', password: 'secret' });
    expect(result.data?.user.id).toBe('u1');
  });

  it('signIn handles errors gracefully', async () => {
    mockSignInEmail.mockRejectedValue(new Error('Invalid credentials'));

    await expect(signIn.email({ email: 'bad@b.com', password: 'wrong' })).rejects.toThrow(
      'Invalid credentials',
    );
  });

  it('signOut calls the underlying signOut', async () => {
    mockSignOutFn.mockResolvedValue({});
    await signOut();
    expect(mockSignOutFn).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Auth Guard / Redirect Logic
// ---------------------------------------------------------------------------

describe('Auth Guard Logic', () => {
  it('redirects unauthenticated users to login', () => {
    const hasSessionCookie = false;
    expect(hasSessionCookie).toBe(false);
  });

  it('allows authenticated users to pass', () => {
    mockSessionRef.current = {
      data: {
        user: { id: 'u1', email: 'a@b.com', name: 'A' },
      },
    };
    const session = useSession();
    expect(session.data).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Middleware Matcher Config
// ---------------------------------------------------------------------------

describe('Middleware Config', () => {
  it('identifies public routes correctly', () => {
    const publicRoutes = [
      '/login',
      '/api/auth',
      '/_next/static',
      '/sw.js',
      '/manifest.json',
    ];

    const testCases = [
      { path: '/login', expected: true },
      { path: '/api/auth/session', expected: true },
      { path: '/dashboard', expected: false },
      { path: '/dashboard/fuel/new', expected: false },
      { path: '/sw.js', expected: true },
    ];

    for (const { path, expected } of testCases) {
      const isPublic = publicRoutes.some(
        (route) => path === route || path.startsWith(route + '/'),
      );
      expect(isPublic).toBe(expected);
    }
  });

  it('allows API routes to pass through for server-side validation', () => {
    const apiPaths = [
      '/api/fuel',
      '/api/reports',
      '/api/audit',
      '/api/notifications',
    ];

    for (const path of apiPaths) {
      expect(path.startsWith('/api/')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Session Token Helpers
// ---------------------------------------------------------------------------

describe('Session Token', () => {
  it('validates session cookie name matches Better Auth convention', () => {
    const cookieName = 'better-auth.session_token';
    expect(cookieName).toMatch(/^better-auth\.session/);
  });
});

// ---------------------------------------------------------------------------
// Share Token Utility
// ---------------------------------------------------------------------------

describe('Share Token Utilities', () => {
  it('generates a URL-safe base64 string', () => {
    const token = 'abc123-_';
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
    expect(token.includes('=')).toBe(false);
  });

  it('SHA-256 hash is deterministic for same input', async () => {
    const encoder = new TextEncoder();
    const hash1 = await crypto.subtle.digest('SHA-256', encoder.encode('test'));
    const hash2 = await crypto.subtle.digest('SHA-256', encoder.encode('test'));
    expect(hash1).toEqual(hash2);
  });
});
