/**
 * Development Data Reset — environment guard
 *
 * The reset is a destructive maintenance operation. Before anything can run
 * (even a dry-run) this guard must confirm we are not pointed at a production
 * environment, and before anything destructive executes it must confirm:
 *
 *   1. `ALLOW_DEV_DATA_RESET=true` is explicitly set; and
 *   2. the exact confirmation phrase was supplied.
 *
 * This module is pure (no I/O beyond reading process.env) so it is easy to
 * unit test.
 */
import {
  DATA_RESET_CONFIRMATION_PHRASE,
  DATA_RESET_ENV_FLAG,
} from './config';

export interface GuardResult {
  /** True when the operation is allowed to proceed. */
  allowed: boolean;
  /** Hard blockers — the operation must stop. */
  errors: string[];
  /** Non-fatal warnings surfaced in the report. */
  warnings: string[];
}

/**
 * Signals that identify a production environment. Used in addition to
 * NODE_ENV because PaaS providers inject their own variables.
 */
const PRODUCTION_ENV_SIGNALS: Array<[string, string]> = [
  ['NODE_ENV', 'production'],
  ['VERCEL_ENV', 'production'],
  ['RAILWAY_ENVIRONMENT', 'production'],
  ['RENDER_ENV', 'production'],
  ['NETLIFY_ENV', 'production'],
  ['VERCEL_GIT_COMMIT_REF', 'main'],
];

function isProductionSignal(
  env: Record<string, string | undefined>,
): string | null {
  for (const [name, value] of PRODUCTION_ENV_SIGNALS) {
    const current = env[name];
    if (current && current.toLowerCase() === value) {
      return `${name}=${current}`;
    }
  }
  return null;
}

/**
 * Check that we are allowed to run a data reset at all (dry-run or execute).
 *
 * @param overrides — injectable env map for tests (defaults to process.env).
 */
export function checkResetAllowed(
  overrides: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >,
): GuardResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const productionSignal = isProductionSignal(overrides);
  if (productionSignal) {
    errors.push(
      `Refusing to run: production environment detected (${productionSignal}). ` +
        'Development data resets are blocked in production.',
    );
  }

  const flag = overrides[DATA_RESET_ENV_FLAG];
  if (flag !== 'true') {
    errors.push(
      `Refusing to run: ${DATA_RESET_ENV_FLAG} is not set to "true". ` +
        `Set ${DATA_RESET_ENV_FLAG}=true in your local .env (never in production) to enable development data resets.`,
    );
  }

  const databaseUrl = overrides.DATABASE_URL || overrides.DATABASE_DIRECT_URL;
  if (databaseUrl) {
    try {
      const { hostname } = new URL(databaseUrl);
      const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
      if (!isLocal) {
        // Hard block for hosts that look like a production database (e.g. a
        // Neon production branch: `ep-xxx-xxx.prod.aws.neon.tech`).
        const hostLabels = hostname.toLowerCase().split('.');
        const looksProduction =
          hostLabels.some((label) => label === 'prod') || hostname.toLowerCase().includes('-prod-');
        if (looksProduction) {
          errors.push(
            `Refusing to run: DATABASE_URL points at a production-looking host (${hostname}). ` +
              'Development data resets are blocked against production databases.',
          );
        } else {
          warnings.push(
            `DATABASE_URL points at a non-local host (${hostname}). Double-check this is a development/staging database before executing.`,
          );
        }
      }
    } catch {
      warnings.push('DATABASE_URL could not be parsed; unable to verify the target host.');
    }
  }

  return { allowed: errors.length === 0, errors, warnings };
}

/**
 * Validate the confirmation phrase for an executable reset.
 */
export function checkConfirmationPhrase(supplied: string | undefined): GuardResult {
  const errors: string[] = [];
  if (supplied !== DATA_RESET_CONFIRMATION_PHRASE) {
    errors.push(
      `Confirmation phrase missing or incorrect. Supply the exact phrase: ${DATA_RESET_CONFIRMATION_PHRASE}`,
    );
  }
  return { allowed: errors.length === 0, errors, warnings: [] };
}
