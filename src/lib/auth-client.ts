import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
  basePath: '/api/auth',
});

/**
 * React hooks and utilities from the auth client.
 * useSession returns { data: { user, session } | null, isPending, error }
 */
export const { useSession, signIn, signOut, signUp } = authClient;
