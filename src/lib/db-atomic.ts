import { getDb } from '@/db';

/**
 * Execute a group of Drizzle mutation builders atomically across both database
 * drivers used by this application.
 *
 * Production uses the Neon HTTP driver, where Drizzle exposes non-interactive
 * atomic transactions through db.batch(). Local development/CI uses
 * postgres.js, where Drizzle exposes interactive db.transaction().
 *
 * The builder must be side-effect free: it should only construct Drizzle query
 * builders for the supplied executor. External I/O (email, document generation,
 * webhooks) must happen after this function resolves successfully.
 */
export async function runAtomicMutations(
  build: (executor: any) => any[],
): Promise<void> {
  const db = getDb() as any;
  const databaseUrl = process.env.DATABASE_URL || '';

  let isLocalPostgres = false;
  try {
    const { hostname } = new URL(databaseUrl);
    isLocalPostgres = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    // getDb() already owns the configuration error path. Keep this helper
    // focused on selecting the correct transaction primitive.
  }

  if (isLocalPostgres) {
    await db.transaction(async (tx: any) => {
      const queries = build(tx);
      for (const query of queries) {
        await query;
      }
    });
    return;
  }

  const queries = build(db);
  if (queries.length === 0) return;

  // Neon HTTP batch is a single non-interactive transaction. The cast keeps
  // the helper compatible with the repo's deliberately unified DB type while
  // preserving runtime driver behavior.
  await db.batch(queries as [any, ...any[]]);
}
