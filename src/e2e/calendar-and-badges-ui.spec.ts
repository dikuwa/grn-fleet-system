import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

test('shared calendar is compact, responsive, and retains form values', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email: 'admin@kavangoeast.gov.na', password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/dashboard/staff/new', { waitUntil: 'networkidle' });

  const dateField = page.getByText('Employment start').locator('..');
  const dateTrigger = dateField.getByRole('button', { name: 'Select date' });
  await expect(dateTrigger).toBeEnabled();
  await dateTrigger.click();

  const previous = page.getByRole('button', { name: 'Go to the Previous Month' });
  const next = page.getByRole('button', { name: 'Go to the Next Month' });
  const month = page.locator('[data-slot="calendar"] [aria-live="polite"]');
  await expect(previous).toBeVisible();
  await expect(next).toBeVisible();
  await expect(month).toBeVisible();

  const [previousBox, nextBox, monthBox] = await Promise.all([
    previous.boundingBox(),
    next.boundingBox(),
    month.boundingBox(),
  ]);
  expect(previousBox).not.toBeNull();
  expect(nextBox).not.toBeNull();
  expect(monthBox).not.toBeNull();
  expect(Math.abs(previousBox!.y - nextBox!.y)).toBeLessThanOrEqual(2);
  expect(previousBox!.y).toBeLessThan(monthBox!.y + monthBox!.height);
  expect(nextBox!.x).toBeGreaterThan(previousBox!.x);

  const typedDate = page.getByLabel('Type date in dd/mm/yyyy format');
  await typedDate.fill('15/08/2026');
  await expect(page.locator('input[name="employmentStartDate"]')).toHaveValue('2026-08-15');
  await expect(dateField.getByRole('button', { name: 'Select date' })).toContainText('15/08/2026');

  const dimensions = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 2);

  await context.close();
  await api.dispose();
});

test('trip count badge uses the universal notification red token', async ({ browser }) => {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email: 'transport.admin@kavangoeast.test', password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  // The sidebar Trips badge now fetches /api/trips/attention and reads
  // data.total (live attention count, not the old snapshot metric).
  await page.route('**/api/trips/attention', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ data: { total: 6 } }),
    });
  });
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

  const tripBadge = page.getByRole('link', { name: /^Trips/ }).getByText('6', { exact: true });
  await expect(tripBadge).toBeVisible();
  await expect(tripBadge).toHaveClass(/bg-status-error-text/);

  await context.close();
  await api.dispose();
});
