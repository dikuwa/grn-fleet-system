import { drizzle as drizzleNeon } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js';
import { neon } from '@neondatabase/serverless';
import postgres from 'postgres';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn('DATABASE_URL is not set. Database operations will fail until it is configured.');
}

function isLocalPostgresUrl(value: string): boolean {
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

// Neon HTTP is ideal for production serverless connections, but it cannot
// connect to a standard local PostgreSQL server. Use postgres.js only for an
// explicitly local hostname so local development and CI can migrate/seed a
// disposable database without changing the production driver.
const connection = databaseUrl
  ? isLocalPostgresUrl(databaseUrl)
    ? postgres(databaseUrl, { max: 10 })
    : neon(databaseUrl)
  : null;

function createNeonDb(client: ReturnType<typeof neon>) {
  return drizzleNeon(client, { schema, casing: 'snake_case' });
}

type Database = ReturnType<typeof createNeonDb>;

export const db: Database | null =
  databaseUrl && connection
    ? isLocalPostgresUrl(databaseUrl)
      ? (drizzlePostgres(connection as ReturnType<typeof postgres>, {
          schema,
          casing: 'snake_case',
        }) as unknown as Database)
      : createNeonDb(connection as ReturnType<typeof neon>)
    : null;

/**
 * Check if database is connected
 */
export function isDbConnected(): boolean {
  return db !== null && connection !== null;
}

/**
 * Get the database instance or throw if not configured
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not configured. Set DATABASE_URL in your environment.');
  }
  return db;
}

export { schema };
