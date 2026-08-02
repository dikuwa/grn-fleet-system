import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';

// Drizzle Kit does not load Next.js' .env.local automatically.
// Preserve any CI/shell-provided values, then fill missing values locally.
dotenv.config({ path: '.env.local', override: false });
dotenv.config({ path: '.env', override: false });

const databaseUrl = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_DIRECT_URL or DATABASE_URL must be configured before running Drizzle Kit.');
}

export default defineConfig({
  schema: './src/db/schema/index.ts',
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
