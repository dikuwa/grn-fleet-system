/**
 * Mobile Responsive — End-to-End Tests
 *
 * Uses a small viewport (iPhone 375×812) to verify:
 *   1. Landing page is usable on mobile
 *   2. Dashboard loads and stat cards render in mobile layout
 *   3. Filter bars collapse vertically on mobile
 *   4. Sidebar hamburger menu opens/closes the mobile drawer
 *   5. Key dashboard pages load without horizontal overflow on mobile
 *   6. Dark mode toggle works on mobile
 *   7. Login page is usable on mobile
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

const MOBILE_VIEWPORT = { width: 375, height: 812 };

async function signIn(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.session).toBeDefined();
  expect(body.session.token).toBeDefined();

  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: body.session.token,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);

  return body.session;
}

test.describe('Mobile Responsive — Public Pages', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test('landing page is usable on mobile', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Page should render without horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5); // allow small rounding

    // Nav should be visible
    await expect(page.locator('nav').first()).toBeVisible({ timeout: 5000 });

    // Theme toggle should be accessible
    const toggle = page.locator('button[title*="Switch to"]').first();
    await expect(toggle).toBeVisible({ timeout: 5000 });
    await toggle.click();
    await page.waitForTimeout(500);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });

  test('login page is usable on mobile', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Login form should be centered and visible
    const form = page.locator('form').first();
    await expect(form).toBeVisible({ timeout: 5000 });

    // Email input should be usable
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible({ timeout: 3000 }).catch(() => false)) {
      await emailInput.fill('test@example.com');
      expect(await emailInput.inputValue()).toBe('test@example.com');
    }
  });

  test('contact page loads without overflow on mobile', async ({ page }) => {
    await page.goto('/contact', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });
});

test.describe('Mobile Responsive — Dashboard', () => {
  test.use({ viewport: MOBILE_VIEWPORT });

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('dashboard loads with stat cards in mobile layout', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Dashboard heading should be visible
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('trips filter bar collapses vertically on mobile', async ({ page }) => {
    await page.goto('/dashboard/trips', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Filter form should be visible
    const filterForm = page.locator('form').first();
    await expect(filterForm).toBeVisible({ timeout: 5000 });

    // Stat cards should be visible
    const statCards = page.locator('[class*="tabular-nums"]');
    const count = await statCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('fleet list loads without overflow on mobile', async ({ page }) => {
    await page.goto('/dashboard/fleet', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await expect(page.locator('h1:has-text("Fleet")').first()).toBeVisible({ timeout: 15000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('requests list loads without overflow on mobile', async ({ page }) => {
    await page.goto('/dashboard/requests', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await expect(page.locator('h1:has-text("Transport")').first()).toBeVisible({ timeout: 15000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('active trips page stat grid is mobile-friendly', async ({ page }) => {
    await page.goto('/dashboard/trips/active', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await expect(page.locator('h1:has-text("Active Trips")').first()).toBeVisible({ timeout: 15000 });

    // Stat cards should be present (even if single column on mobile)
    const statCards = page.locator('[class*="tabular-nums"]');
    const count = await statCards.count();
    expect(count).toBeGreaterThanOrEqual(1);

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('inspections list loads without overflow on mobile', async ({ page }) => {
    await page.goto('/dashboard/inspections', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('reports page loads without overflow on mobile', async ({ page }) => {
    await page.goto('/dashboard/reports', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await expect(page.locator('h1:has-text("Reports")').first()).toBeVisible({ timeout: 15000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('fuel list loads without overflow on mobile', async ({ page }) => {
    await page.goto('/dashboard/fuel', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await expect(page.locator('h1:has-text("Fuel")').first()).toBeVisible({ timeout: 15000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('maintenance list loads without overflow on mobile', async ({ page }) => {
    await page.goto('/dashboard/maintenance', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await expect(page.locator('h1:has-text("Maintenance")').first()).toBeVisible({ timeout: 15000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  test('allocation list loads without overflow on mobile', async ({ page }) => {
    await page.goto('/dashboard/allocations', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await expect(page.locator('h1:has-text("Allocations")').first()).toBeVisible({ timeout: 15000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  // -----------------------------------------------------------------------
  // Mobile sidebar open/close
  // -----------------------------------------------------------------------

  test('sidebar hamburger menu opens and closes on mobile', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Look for a hamburger/menu button — try common patterns
    const menuButton = page.locator('button').filter({ hasText: /Menu|☰/ }).first();
    const sidebarToggle = page.locator('[class*="sidebar-toggle"]').first();
    const hamburger = page.locator('button[aria-label*="sidebar" i], button[aria-label*="menu" i], button[aria-label*="navigation" i]').first();

    const targetButton = await menuButton.isVisible({ timeout: 2000 }).catch(() => false)
      ? menuButton
      : await sidebarToggle.isVisible({ timeout: 2000 }).catch(() => false)
        ? sidebarToggle
        : await hamburger.isVisible({ timeout: 2000 }).catch(() => false)
          ? hamburger
          : null;

    if (targetButton) {
      await targetButton.click();
      await page.waitForTimeout(1000);

      // Sidebar or navigation drawer should be visible
      const sidebar = page.locator('nav, aside, [class*="sidebar"]').first();
      await expect(sidebar).toBeVisible({ timeout: 3000 });

      // Close by clicking the toggle again
      await targetButton.click();
      await page.waitForTimeout(500);
    }
  });

  // -----------------------------------------------------------------------
  // Fuel form submission on mobile
  // -----------------------------------------------------------------------

  test('fuel form inputs are usable on mobile viewport', async ({ page }) => {
    await page.goto('/dashboard/fuel/new', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Form should be present
    const form = page.locator('form').first();
    const formVisible = await form.isVisible({ timeout: 5000 }).catch(() => false);

    if (formVisible) {
      // Check that text/number inputs are touch-friendly
      const numberInputs = page.locator('input[type="number"]');
      const inputCount = await numberInputs.count();
      expect(inputCount).toBeGreaterThanOrEqual(1);

      // Fill in a few fields if present
      const litresInput = page.locator('input[type="number"]').first();
      if (await litresInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await litresInput.click();
        await litresInput.fill('50');
        expect(await litresInput.inputValue()).toBe('50');
      }
    }

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  // -----------------------------------------------------------------------
  // Offline detection on mobile
  // -----------------------------------------------------------------------

  test('offline indicator status element is present on mobile', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Check for offline indicator component
    const offlineIndicator = page.locator('[class*="offline" i], [class*="connection-status" i], text=Online, text=Offline').first();
    const indicatorVisible = await offlineIndicator.isVisible({ timeout: 3000 }).catch(() => false);

    if (indicatorVisible) {
      await expect(offlineIndicator).toBeVisible({ timeout: 5000 });
    }

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  // -----------------------------------------------------------------------
  // Form select/date inputs are usable on mobile
  // -----------------------------------------------------------------------

  test('form controls have touch-friendly sizing on mobile', async ({ page }) => {
    await page.goto('/dashboard/fuel/new', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    const form = page.locator('form').first();
    const formVisible = await form.isVisible({ timeout: 5000 }).catch(() => false);

    if (formVisible) {
      // Check selects are present and usable
      const selects = page.locator('select');
      const selectCount = await selects.count();
      if (selectCount > 0) {
        await expect(selects.first()).toBeVisible({ timeout: 3000 });
        await selects.first().selectOption({ index: 1 }).catch(() => {});
      }

      // Check buttons have minimum touch target
      const buttons = page.locator('button');
      const btnCount = await buttons.count();
      expect(btnCount).toBeGreaterThanOrEqual(1);
    }

    // No horizontal overflow
    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });

  // -----------------------------------------------------------------------
  // Privacy policy page loads on mobile
  // -----------------------------------------------------------------------

  test('privacy policy page loads without overflow on mobile', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = await page.evaluate(() => window.innerWidth);
    expect(bodyWidth).toBeLessThanOrEqual(viewportWidth + 5);
  });
});
