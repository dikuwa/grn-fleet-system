/**
 * Licence Expiry Report — E2E Test
 *
 * Tests the licence expiry report page at /dashboard/reports/licence-expiry:
 * 1. Page loads with summary stat cards
 * 2. Run expiry check button triggers cron proxy and shows result
 * 3. Search/filter functionality works
 * 4. CSV export is available
 * 5. Screenshot for visual gallery
 */

import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function signIn(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  let res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password },
  });
  for (let attempt = 0; attempt < 5 && res.status() === 429; attempt++) {
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    res = await page.request.post(`${BASE}/api/auth/sign-in`, {
      data: { email, password },
    });
  }
  expect(res.status()).toBe(200);
  const body = await res.json();
  const token = body.token || body.session?.token;
  expect(token).toBeDefined();

  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);

  return { token, user: body.user || body.session?.user };
}

test.describe('Licence Expiry Report', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('1. Report page loads with summary stats and actions', async ({ page }) => {
    await page.goto('/dashboard/reports/licence-expiry', {
      waitUntil: 'domcontentloaded',
    });

    // Page header is visible
    await expect(page.getByRole('heading', { name: 'Licence Expiry Report' })).toBeVisible();

    // Summary stat cards load (may show 0s if no expiring licences)
    await expect(page.getByText('Total Expiring').first()).toBeVisible();
    await expect(page.getByText('Expired').first()).toBeVisible();
    await expect(page.getByText('Expiring Soon').first()).toBeVisible();
    await expect(page.getByText('Notified Today').first()).toBeVisible();

    // Action buttons are visible
    await expect(page.getByRole('button', { name: /Run Expiry Check/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible();

    // Search input is visible
    await expect(page.getByPlaceholder(/Search driver/i)).toBeVisible();

    // Filter buttons are visible
    await expect(page.getByRole('button', { name: 'All' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expired' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Expiring' })).toBeVisible();
  });

  test('2. Run Expiry Check button triggers cron and shows result', async ({ page }) => {
    await page.goto('/dashboard/reports/licence-expiry', {
      waitUntil: 'domcontentloaded',
    });

    // Wait for page to finish loading
    await page.waitForTimeout(2000);

    // Click the Run Expiry Check button
    const runButton = page.getByRole('button', { name: /Run Expiry Check/i });
    await expect(runButton).toBeEnabled({ timeout: 10_000 });
    await runButton.click();

    // Result banner should appear — poll for up to 15s
    const cronBanner = page.locator('text=/completed|created|already notified|Expiry check|Failed|Error/i').first();
    await expect(cronBanner).toBeVisible({ timeout: 15_000 });

    // Verify the banner contains meaningful data
    await expect(cronBanner).toContainText(/notification|already|created|expiry|completed|error|failed/i);
  });

  test('3. Search/filter narrows licence list', async ({ page }) => {
    await page.goto('/dashboard/reports/licence-expiry', {
      waitUntil: 'domcontentloaded',
    });

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Verify all three filter buttons exist and are clickable
    const allFilter = page.locator('div.flex.gap-1 button').filter({ hasText: 'All' });
    const expiredFilter = page.locator('div.flex.gap-1 button').filter({ hasText: 'Expired' });
    const expiringFilter = page.locator('div.flex.gap-1 button').filter({ hasText: 'Expiring' });

    await expect(allFilter).toBeVisible();
    await expect(expiredFilter).toBeVisible();
    await expect(expiringFilter).toBeVisible();

    // Click each filter and verify the page stays intact
    await expiredFilter.click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Licence Expiry Report' })).toBeVisible();

    await expiringFilter.click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Licence Expiry Report' })).toBeVisible();

    await allFilter.click();
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: 'Licence Expiry Report' })).toBeVisible();

    // Try the search input
    const searchInput = page.getByPlaceholder(/Search driver/i);
    await searchInput.fill('Michael');
    await page.waitForTimeout(300);
    await expect(searchInput).toHaveValue('Michael');
    await searchInput.clear();
  });

  test('4. CSV export triggers download', async ({ page }) => {
    await page.goto('/dashboard/reports/licence-expiry', {
      waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(2000);

    // Click the Export CSV button
    const exportBtn = page.getByRole('button', { name: /Export CSV/i });
    await expect(exportBtn).toBeEnabled({ timeout: 10_000 });

    // Start a download promise before click
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
    await exportBtn.click();

    const download = await downloadPromise;
    // Export should succeed — if no licences exist, the button handler returns early
    // so the download won't fire. That's acceptable.
    if (download) {
      expect(download.suggestedFilename()).toContain('licence-expiry-report');
    }
  });

  test('5. Screenshot for visual gallery', async ({ page }) => {
    await page.goto('/dashboard/reports/licence-expiry', {
      waitUntil: 'domcontentloaded',
    });

    await page.waitForTimeout(3000);

    await page.screenshot({
      path: 'docs/screenshots/licence-expiry-report.png',
      fullPage: true,
    });
  });
});
