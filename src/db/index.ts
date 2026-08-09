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

// Neon HTTP remains the default production driver because it is efficient for
// serverless one-shot queries. Interactive transaction callbacks need a
// session-capable connection, so production transaction() calls are delegated
// lazily to postgres.js while all ordinary reads/writes stay on Neon HTTP.
const connection = databaseUrl
  ? isLocalPostgresUrl(databaseUrl)
    ? postgres(databaseUrl, { max: 10 })
    : neon(databaseUrl)
  : null;

function createNeonDb(client: ReturnType<typeof neon>) {
  return drizzleNeon(client, { schema, casing: 'snake_case' });
}

function createPostgresDb(client: ReturnType<typeof postgres>) {
  return drizzlePostgres(client, { schema, casing: 'snake_case' });
}

type Database = ReturnType<typeof createNeonDb>;
type PostgresDatabase = ReturnType<typeof createPostgresDb>;

let interactiveConnection: ReturnType<typeof postgres> | null = null;
let interactiveDb: PostgresDatabase | null = null;

function getInteractiveDb(): PostgresDatabase {
  if (!databaseUrl) {
    throw new Error('Database not configured. Set DATABASE_URL in your environment.');
  }

  if (isLocalPostgresUrl(databaseUrl)) {
    if (!connection || typeof connection === 'function') {
      return createPostgresDb(connection as ReturnType<typeof postgres>);
    }
    throw new Error('Local PostgreSQL transaction connection is unavailable.');
  }

  if (!interactiveConnection) {
    interactiveConnection = postgres(databaseUrl, {
      max: 1,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
    });
    interactiveDb = createPostgresDb(interactiveConnection);
  }

  return interactiveDb!;
}

function attachInteractiveTransactions(client: Database): Database {
  type Transaction = PostgresDatabase['transaction'];
  const target = client as unknown as { transaction: Transaction };
  target.transaction = ((...args: Parameters<Transaction>) =>
    getInteractiveDb().transaction(...args)) as Transaction;
  return client;
}

export const db: Database | null =
  databaseUrl && connection
    ? isLocalPostgresUrl(databaseUrl)
      ? (createPostgresDb(connection as ReturnType<typeof postgres>) as unknown as Database)
      : attachInteractiveTransactions(createNeonDb(connection as ReturnType<typeof neon>))
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
