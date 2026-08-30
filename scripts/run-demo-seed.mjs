#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const productionContext =
  process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';

if (productionContext && !process.env.SEED_ADMIN_PASSWORD) {
  console.error('❌ SEED_ADMIN_PASSWORD must be explicitly configured before running demo seeds in production.');
  process.exit(1);
}

const result = spawnSync('pnpm', ['exec', 'tsx', 'src/seed/index.ts'], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(`❌ Failed to start demo seed: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
