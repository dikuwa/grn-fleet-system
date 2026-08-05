/**
 * Minimal-Seed Login Verification — End-to-End Test
 *
 * The `pnpm seed:minimal` seed creates exactly 9 login accounts. Each one
 * must be able to sign in and land on the dashboard for the workspace their
 * role entitles them to (resolved by src/lib/workspaces.ts):
 *
 *   tenant-admin        → Tenant Administration (metrics: Active employees)
 *   transport-admin     → Transport Administration (Active requests)
 *   requester           → Personal Requester (My pending requests)
 *   supervisor          → Approvals (Assigned approvals)
 *   release-officer     → Approvals (Assigned approvals)
 *   regional-authoriser → Approvals (Assigned approvals)
 *   national-release    → Approvals (Assigned approvals)
 *   national-authoriser → Approvals (Assigned approvals)
 *   driver              → Driver (My active trips)
 *
 * Both authentication paths are verified for every account:
 *   1. Email login via POST /api/auth/sign-in
 *   2. Username login via POST /api/auth/custom-sign-in (the username-based
 *      path used by the public-facing login form)
 *
 * Runs serially: every account shares the same tenant DB and parallel
 * writers can race notification/other counters on a small dev database.
 */
import { expect, request as playwrightRequest, test, type Browser } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const ACCOUNTS = [
  {
    email: 'admin@kavangoeast.gov.na',
    username: 'tenant-admin',
    workspace: 'Tenant Administration',
    metric: 'Active employees',
  },
  {
    email: 'transport.admin@kavangoeast.test',
    username: 'transport-admin',
    workspace: 'Transport Administration',
    metric: 'Active requests',
  },
  {
    email: 'requester@kavangoeast.test',
    username: 'requester',
    workspace: 'Personal Requester',
    metric: 'My pending requests',
  },
  {
    email: 'supervisor@kavangoeast.test',
    username: 'supervisor',
    workspace: 'Approvals',
    metric: 'Assigned approvals',
  },
  {
    email: 'release.officer@kavangoeast.test',
    username: 'release-officer',
    workspace: 'Approvals',
    metric: 'Assigned approvals',
  },
  {
    email: 'regional.authoriser@kavangoeast.test',
    username: 'regional-authoriser',
    workspace: 'Approvals',
    metric: 'Assigned approvals',
  },
  {
    email: 'national.release@kavangoeast.test',
    username: 'national-release',
    workspace: 'Approvals',
    metric: 'Assigned approvals',
  },
  {
    email: 'national.authoriser@kavangoeast.test',
    username: 'national-authoriser',
    workspace: 'Approvals',
    metric: 'Assigned approvals',
  },
  {
    email: 'driver@kavangoeast.test',
    username: 'driver',
    workspace: 'Driver',
    metric: 'My active trips',
  },
] as const;

async function assertRoleDashboard(
  browser: Browser,
  api: Awaited<ReturnType<typeof playwrightRequest.newContext>>,
  account: (typeof ACCOUNTS)[number],
) {
  const context = await browser.newContext({ storageState: await api.storageState() });
  const page = await context.newPage();
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await expect(page).toHaveURL(/\/dashboard/);

  // The workspace label is rendered as the dashboard page title.
  await expect(page.locator('h1').first()).toHaveText(account.workspace, {
    timeout: 20_000,
  });
  // The workspace-specific metric confirms the right role dashboard.
  await expect(page.getByText(account.metric).first()).toBeVisible({ timeout: 10_000 });

  await context.close();
}

test.describe.serial('Minimal-seed login accounts land on role-correct dashboards', () => {
  test.setTimeout(300_000);

  for (const account of ACCOUNTS) {
    test(`sign in with email as ${account.username} → ${account.workspace} workspace`, async ({
      browser,
    }) => {
      const api = await playwrightRequest.newContext({ baseURL: BASE });
      const signIn = await api.post('/api/auth/sign-in', {
        data: { email: account.email, password: PASSWORD },
      });
      expect(signIn.status(), `sign in ${account.email}: ${await signIn.text()}`).toBe(200);

      await assertRoleDashboard(browser, api, account);
      await api.dispose();
    });

    test(`sign in with username '${account.username}' → ${account.workspace} workspace`, async ({
      browser,
    }) => {
      const api = await playwrightRequest.newContext({ baseURL: BASE });
      const signIn = await api.post('/api/auth/custom-sign-in', {
        data: { username: account.username, password: PASSWORD },
      });
      expect(signIn.status(), `username sign in ${account.username}: ${await signIn.text()}`).toBe(
        200,
      );

      await assertRoleDashboard(browser, api, account);
      await api.dispose();
    });
  }
});
