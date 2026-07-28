import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

test.describe.configure({ mode: 'serial' });
test.setTimeout(180_000);

test('request filters clear completely and scoped statistics remain numeric', async ({
  browser,
}) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email: 'transport.admin@kavangoeast.test', password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/dashboard/requests', { waitUntil: 'domcontentloaded' });

  const metricLabels = ['Total Requests', 'Pending Approval', 'Active / In Progress', 'Closed'];
  const initialMetrics: string[] = [];
  for (const label of metricLabels) {
    const card = page.getByText(label, { exact: true }).locator('..');
    const value = (await card.locator('p').first().textContent())?.trim() ?? '';
    expect(value).toMatch(/^(0|[1-9]\d*)$/);
    initialMetrics.push(value);
  }

  await page.goto('/dashboard/requests?scope=regional&status=submitted&page=2', {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('link', { name: /clear filters/i })).toBeVisible();

  for (let index = 0; index < metricLabels.length; index += 1) {
    const card = page.getByText(metricLabels[index], { exact: true }).locator('..');
    await expect(card.locator('p').first()).toHaveText(initialMetrics[index]);
  }

  await page.getByRole('link', { name: /clear filters/i }).click();
  await expect(page).toHaveURL(/\/dashboard\/requests$/);
  await expect(page.getByRole('link', { name: /clear filters/i })).toHaveCount(0);

  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 2);

  await context.close();
  await api.dispose();
});

test('database-backed metric pages load without query fallbacks', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email: 'transport.admin@kavangoeast.test', password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1280, height: 900 },
  });
  const routes = [
    '/dashboard/allocations',
    '/dashboard/trips',
    '/dashboard/fleet',
    '/dashboard/fleet/defects',
    '/dashboard/fuel',
    '/dashboard/reimbursements',
    '/dashboard/inspections',
    '/dashboard/maintenance',
    '/dashboard/documents',
  ];

  for (const route of routes) {
    const page = await context.newPage();
    const response = await page.goto(route, { waitUntil: 'domcontentloaded' });
    expect(response?.status(), route).toBeLessThan(400);
    await expect(page.getByText(/unable to load/i), route).toHaveCount(0);
    await page.close();
  }

  await context.close();
  await api.dispose();
});
