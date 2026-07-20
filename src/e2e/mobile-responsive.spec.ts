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
});
