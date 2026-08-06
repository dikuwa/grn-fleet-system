import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function signIn(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', {
    data: { email, password: PASSWORD },
  });
  expect(res.status(), await res.text()).toBe(200);
  return api;
}

test('staff directory search accepts typing and filters by query', async ({ browser }) => {
  const api = await signIn('admin@kavangoeast.gov.na');
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/dashboard/staff', { waitUntil: 'domcontentloaded' });

  const searchInput = page.getByPlaceholder(/Search by name, employee number/);
  await expect(searchInput).toBeVisible();

  // Regression: typing must not be reverted by the URL-adoption effect.
  await searchInput.fill('KERC');
  await expect(searchInput).toHaveValue('KERC');

  // The 300ms debounce commits the query to the URL and the server filters.
  // The staff page renders against a remote Neon database (~2–4s per render),
  // so the URL-commit assertion needs a generous timeout.
  await expect(page).toHaveURL(/[?&]q=KERC/, { timeout: 15_000 });
  await expect(
    page.locator('tbody tr').first().getByText(/KERC/, { exact: false }),
  ).toBeVisible({ timeout: 15_000 });

  await context.close();
  await api.dispose();
});

test('user management rows never show two Active labels', async ({ browser }) => {
  const api = await signIn('admin@kavangoeast.gov.na');
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/dashboard/admin/users', { waitUntil: 'domcontentloaded' });

  const rows = page.locator('div.divide-y > div:visible');
  const retryButton = page.getByRole('button', { name: 'Retry' });

  // Cold-start resilience: right after the E2E server boots, the first
  // client-side fetch can hit a cold Neon connection and render the Retry
  // card (the query self-heals via retries once the pool is warm). Wait for
  // rows to appear, and click Retry if the error card sticks.
  await expect
    .poll(
      async () => {
        if (await retryButton.isVisible().catch(() => false)) {
          await retryButton.click();
          return false;
        }
        return (await rows.count()) > 0;
      },
      { timeout: 25_000 },
    )
    .toBe(true);

  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(0);
  for (let i = 0; i < rowCount; i += 1) {
    // The account badge ("Active") must not be duplicated by the linked-staff
    // badge ("Active") on the same row.
    const activeBadges = await rows.nth(i).getByText('Active', { exact: true }).count();
    expect(activeBadges, `row ${i} has ${activeBadges} Active badge(s)`).toBeLessThanOrEqual(1);
  }

  await context.close();
  await api.dispose();
});

test('inspector workspace: inspections attention badge + topbar bell total', async ({
  browser,
}) => {
  const api = await signIn('inspector@kavangoeast.test');
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // The hook waits for every badge endpoint the workspace navigation declares
  // before merging counts, so mock them all to keep the test deterministic.
  await page.route('**/api/inspections/attention', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 2 } }),
    });
  });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  // Sidebar: Assigned Inspections badge (aria-hidden pill located by class).
  const sidebarBadge = page
    .getByRole('link', { name: /Assigned Inspections/ })
    .locator('span.bg-status-error-text');
  await expect(sidebarBadge).toBeVisible();
  await expect(sidebarBadge).toHaveText('2');
  await expect(
    page.getByRole('link', { name: /Assigned Inspections.*2 items require your attention/ }),
  ).toBeVisible();

  // Topbar: the bell carries the amber total-attention pill. Scoped to the
  // header — the sidebar also has a "Notifications" link whose accessible name
  // collides with the bell's aria-label.
  const bell = page.locator('header a[href="/dashboard/notifications"]');
  await expect(bell).toBeVisible();
  await expect(bell.locator('span.bg-amber-500')).toHaveText('2');
  await expect(
    page.getByRole('link', { name: /Notifications.*2 items need your attention/ }),
  ).toBeVisible();

  await context.close();
  await api.dispose();
});

test('transport admin: licence verification attention badge', async ({ browser }) => {
  const api = await signIn('transport.admin@kavangoeast.test');
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // Transport Administration declares four badge queries; the hook's Promise.all
  // waits for all of them before merging, so mock every one the sidebar renders.
  await page.route('**/api/drivers/licences/attention', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 5 } }),
    });
  });
  await page.route('**/api/approvals/attention', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 0 } }),
    });
  });
  await page.route('**/api/trips/attention', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 0 } }),
    });
  });
  await page.route('**/api/inspections/attention', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 0 } }),
    });
  });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  const badge = page
    .getByRole('link', { name: /Licence Verification/ })
    .locator('span.bg-status-error-text');
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('5');
  await expect(
    page.getByRole('link', { name: /Licence Verification.*5 items require your attention/ }),
  ).toBeVisible();

  await context.close();
  await api.dispose();
});
