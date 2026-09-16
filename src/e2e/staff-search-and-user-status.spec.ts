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

  // Regression: typing must reach the hydrated LiveSearchInput and must not be
  // reverted by its URL-adoption effect. The clear-search control only renders
  // after React has accepted the new controlled value, so it is also a stable
  // hydration signal for the debounce assertion below.
  await searchInput.fill('KERC');
  await expect(searchInput).toHaveValue('KERC');
  await expect(page.getByRole('button', { name: 'Clear search' })).toBeVisible({ timeout: 5_000 });

  // The 300ms debounce commits the query to the URL and the server filters.
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

  // User Management uses clickable card rows rather than a table/divide-y list.
  // Scope to the row contract itself instead of presentation-only container classes.
  const rows = page.locator('div.cursor-pointer.border-b');
  const retryButton = page.getByRole('button', { name: 'Retry' });

  // Cold-start resilience: the first client-side fetch can occasionally render
  // the Retry card. Wait for rows to appear, and retry the query if that card sticks.
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

  // Sidebar workspace attention and topbar notification attention are separate
  // contracts. Mock each endpoint explicitly so the test proves both without
  // coupling the bell to sidebar totals.
  await page.route('**/api/inspections/attention', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 2 } }),
    });
  });
  await page.route('**/api/notifications?limit=50', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        data: {
          notifications: [],
          unreadCount: 0,
          actionRequiredCount: 2,
          attentionCount: 2,
          preferences: {
            emailNotifications: true,
            inAppNotifications: true,
            quietHoursStart: null,
            quietHoursEnd: null,
          },
        },
      }),
    });
  });

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  // Sidebar: Assigned Inspections badge.
  const sidebarBadge = page
    .getByRole('link', { name: /Assigned Inspections/ })
    .locator('span.bg-status-error-text');
  await expect(sidebarBadge).toBeVisible();
  await expect(sidebarBadge).toHaveText('2');
  await expect(
    page.getByRole('link', { name: /Assigned Inspections.*2 items require your attention/ }),
  ).toBeVisible();

  // Topbar: the bell displays the notification feed's attentionCount.
  const bell = page.locator('header a[href="/dashboard/notifications"]');
  await expect(bell).toBeVisible();
  await expect(bell.locator('span.bg-status-error-text')).toHaveText('2');
  await expect(
    page.getByRole('link', { name: /Notifications.*2 requiring attention/ }),
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
