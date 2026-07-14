import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.warn(
    'DATABASE_URL is not set. Database operations will fail until it is configured.',
  );
}

// Create a neon connection instance
const sql = databaseUrl ? neon(databaseUrl) : null;

// Create drizzle instance with schema
export const db = sql
  ? drizzle(sql, { schema, casing: 'snake_case' })
  : null;

/**
 * Check if database is connected
 */
export function isDbConnected(): boolean {
  return db !== null && sql !== null;
}

/**
 * Get the database instance or throw if not configured
 */
export function getDb() {
  if (!db) {
    throw new Error(
      'Database not configured. Set DATABASE_URL in your environment.',
    );
  }
  return db;
}

export { schema };
