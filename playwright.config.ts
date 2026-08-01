import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/e2e',
  // Tests that render Leaflet maps / create requests need more than the 30s
  // default.  A 60s global budget with per-spec overrides keeps slow specs
  // from timing out under parallel load while still failing fast on real bugs.
  timeout: 60_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Cap local parallelism: SQLite (the local dev DB) contends under heavy
  // concurrent writes, which is the main source of parallel-only flakes.
  workers: process.env.CI ? 1 : 4,
  reporter: [['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'pkill -f "next start" 2>/dev/null; pkill -f "next build" 2>/dev/null; sleep 1; pnpm build && pnpm db:seed-e2e && pnpm start',
    port: 3000,
    timeout: 600000,
    reuseExistingServer: !process.env.CI,
    env: {
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET || 'test-secret-thirty-two-characters-long!',
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
      NEXT_PUBLIC_APP_NAME: 'GovFleet Namibia',
    },
  },
});
