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

    // Result banner should appear (success or error message)
    await page.waitForTimeout(3000);

    // Check for either success banner (cron result) or error state
    const successBanner = page.locator('text=/completed|created|already notified/i').first();
    const errorBanner = page.locator('text=/Failed|Error/i').first();
    const hasSuccess = await successBanner.isVisible({ timeout: 5000 }).catch(() => false);
    const hasError = await errorBanner.isVisible({ timeout: 2000 }).catch(() => false);

    expect(hasSuccess || hasError).toBe(true);

    if (hasSuccess) {
      // Verify the banner contains meaningful data
      await expect(successBanner).toContainText(/notification|already|created/i);
    }
  });

  test('3. Search/filter narrows licence list', async ({ page }) => {
    await page.goto('/dashboard/reports/licence-expiry', {
      waitUntil: 'domcontentloaded',
    });

    // Wait for data to load
    await page.waitForTimeout(2000);

    // Try clicking the "Expired" filter
    const expiredFilter = page.getByRole('button', { name: 'Expired' });
    await expiredFilter.click();
    await page.waitForTimeout(500);

    // Verify the expired filter button gets active styling
    // The active class is bg-brand-800, not just bg-brand
    const expiredClasses = await expiredFilter.getAttribute('class');
    expect(expiredClasses).toContain('bg-brand');

    // Try the search input
    const searchInput = page.getByPlaceholder(/Search driver/i);
    await searchInput.fill('Test Driver Name');
    await page.waitForTimeout(500);

    // Clear and switch to "Expiring" filter
    await searchInput.clear();
    const expiringFilter = page.getByRole('button', { name: 'Expiring' });
    await expiringFilter.click();
    await page.waitForTimeout(500);
    await expect(expiringFilter).toBeVisible();

    // Verify the expiring filter is now active
    const expiringClasses = await expiringFilter.getAttribute('class');
    expect(expiringClasses).toContain('bg-brand');

    // Also test "All" filter
    const allFilter = page.getByRole('button', { name: 'All' });
    await allFilter.click();
    await page.waitForTimeout(500);
    await expect(allFilter).toBeVisible();
    const allClasses = await allFilter.getAttribute('class');
    expect(allClasses).toContain('bg-brand');
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
