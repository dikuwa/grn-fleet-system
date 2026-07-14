import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '@/db';
import { env } from '@/env';

/**
 * Better Auth server configuration
 *
 * Password-only authentication with no public sign-up.
 * Accounts are created by authorised administrators only.
 */
export const auth = betterAuth({
  database: db
    ? drizzleAdapter(db, {
        provider: 'pg',
      })
    : undefined,

  baseURL: env.BETTER_AUTH_URL || 'http://localhost:3000',
  basePath: '/api/auth',

  secret: env.BETTER_AUTH_SECRET || 'dev-secret-change-in-production-min-32-chars!!',

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    autoSignIn: true,
  },

  socialProviders: {},

  accountLinking: {
    enabled: false,
  },

  session: {
    expiresIn: 7 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60,
    },
  },
});

export type AuthUser = {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
};
