/**
 * Key Pages UI Smoke — End-to-End Test
 *
 * Signs in as the roles with the broadest page access and verifies the main
 * dashboard areas render (no error boundary, no crash) against a freshly
 * reset development database:
 *
 *   transport-admin: /dashboard, requests list, new-request form, fleet,
 *                    allocations, approvals, trips
 *   requester:       requests list + new-request form
 *   driver:          driver self-service + trips
 *
 * Pages are rendered server-side; asserting the page <h1> plus the absence
 * of the shared error/empty boundaries proves the route loaded.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function signedInContext(
  browser: import('@playwright/test').Browser,
  email: string,
) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(signIn.status(), `sign in ${email}: ${await signIn.text()}`).toBe(200);
  const context = await browser.newContext({ storageState: await api.storageState() });
  await api.dispose();
  return context;
}

test.describe('Key dashboard pages render after dev reset', () => {
  test.setTimeout(300_000);

  test('transport-admin can open the main management pages', async ({ browser }) => {
    const context = await signedInContext(browser, 'transport.admin@kavangoeast.test');
    const page = await context.newPage();

    const pages: Array<{ path: string; h1: RegExp | string }> = [
      { path: '/dashboard', h1: /Transport Administration|Active requests/ },
      { path: '/dashboard/requests', h1: /Requests/ },
      { path: '/dashboard/requests/new', h1: /New Transport Request/ },
      { path: '/dashboard/fleet', h1: 'Fleet' },
      { path: '/dashboard/allocations', h1: /Vehicle Allocations/ },
      { path: '/dashboard/approvals', h1: 'Approvals' },
      { path: '/dashboard/trips', h1: /Trips/ },
    ];

    for (const { path, h1 } of pages) {
      await page.goto(path, { waitUntil: 'load', timeout: 60_000 });
      await expect(page.locator('h1').first()).toContainText(h1, { timeout: 20_000 });
      // No shared error boundary should be present.
      await expect(page.getByText('Unable to Load', { exact: false }).first()).not.toBeVisible();
      await expect(page.getByText('Authentication Required').first()).not.toBeVisible();
    }

    await context.close();
  });

  test('requester can open the request pages', async ({ browser }) => {
    const context = await signedInContext(browser, 'requester@kavangoeast.test');
    const page = await context.newPage();

    await page.goto('/dashboard/requests', { waitUntil: 'load', timeout: 60_000 });
    // The h1 is role-scoped ("Operational Requests" / "My Requests").
    await expect(page.locator('h1').first()).toContainText(/Requests/, { timeout: 20_000 });

    await page.goto('/dashboard/requests/new', { waitUntil: 'load', timeout: 60_000 });
    await expect(page.locator('h1').first()).toContainText(/New Transport Request/, {
      timeout: 20_000,
    });

    await context.close();
  });

  test('driver can open driver self-service and trips', async ({ browser }) => {
    const context = await signedInContext(browser, 'driver@kavangoeast.test');
    const page = await context.newPage();

    await page.goto('/dashboard/driver-self-service', { waitUntil: 'load', timeout: 60_000 });
    await expect(page.locator('h1').first()).toContainText(/Driver Self-Service/, {
      timeout: 20_000,
    });

    await page.goto('/dashboard/trips', { waitUntil: 'load', timeout: 60_000 });
    await expect(page.locator('h1').first()).toContainText(/Trips/, { timeout: 20_000 });

    await context.close();
  });
});
