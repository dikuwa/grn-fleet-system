import { z } from 'zod';

const envSchema = z.object({
  // Database
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url().optional(),

  // Auth
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_APP_NAME: z.string().min(1),

  // R2 Storage
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET_NAME: z.string().optional(),
  R2_ENDPOINT: z.string().optional(),

  // Email
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // Google Maps
  GOOGLE_MAPS_SERVER_API_KEY: z.string().optional(),
  NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY: z.string().optional(),

  // Rate Limiting
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Background Jobs
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),

  // Monitoring
  SENTRY_DSN: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),

  // Security
  SHARE_TOKEN_PEPPER: z.string().min(1).optional(),
  DOCUMENT_HASH_SECRET: z.string().optional(),
  AUDIT_CHAIN_SECRET: z.string().optional(),

  // Feature Flags
  NEXT_PUBLIC_ENABLE_OFFLINE_DRAFTS: z.string().optional().default('true'),
  ENABLE_EXTERNAL_SHARING: z.string().optional().default('false'),
  ENABLE_WHATSAPP_API: z.string().optional().default('false'),
  ENABLE_SMS: z.string().optional().default('false'),
  SMS_PROVIDER: z.string().optional().default('disabled'),

  // Local Seed
  SEED_ADMIN_EMAIL: z.string().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  try {
    return envSchema.parse(process.env);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missing = error.errors
        .filter((e) => e.message === 'Required')
        .map((e) => e.path.join('.'));
      if (missing.length > 0) {
        console.warn(
          `Missing required environment variables: ${missing.join(', ')}. ` +
            'The application may not function correctly without these values configured.',
        );
      }
    }
    // Gracefully return partial env in development with defaults
    return envSchema.partial().parse(process.env) as Env;
  }
}

export const env = validateEnv();

/**
 * Check if a specific env var is available
 */
export function hasEnvVar(name: keyof Env): boolean {
  const value = env[name];
  return value !== undefined && value !== '' && value !== 'disabled';
}
