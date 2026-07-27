/**
 * Dark Mode Toggle — End-to-End Tests
 *
 * Verifies:
 *   1. Landing page has dark mode toggle button
 *   2. Toggle switches theme (CSS class + localStorage) and reverts
 *   3. Contact, privacy, and login pages each have a toggle
 *   4. Dashboard topbar has a dark mode toggle button
 *   5. Theme persistence works across page navigation
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function signIn(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password },
  });
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

async function selectTheme(page: Page, theme: 'Light' | 'Dark' | 'System') {
  const trigger = page.getByRole('button', { name: /select theme/i }).first();
  await expect(trigger).toBeVisible({ timeout: 5000 });
  await trigger.click();
  await page.getByRole('menuitemradio', { name: theme }).click();
}

test.describe('Dark Mode — Public Pages', () => {
  // Reset theme before each test so we start clean
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('govfleet-theme-test-initialised')) {
        localStorage.removeItem('govfleet-theme');
        sessionStorage.setItem('govfleet-theme-test-initialised', 'true');
      }
    });
  });

  test('landing page has dark mode toggle and switches theme', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Toggle button should exist (Sun or Moon icon)
    await selectTheme(page, 'Dark');
    await page.waitForTimeout(500);
    await expect(page.locator('html')).toHaveClass(/dark/);

    await selectTheme(page, 'Light');
    await page.waitForTimeout(500);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('contact page has dark mode toggle', async ({ page }) => {
    await page.goto('/contact', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    await expect(page.getByRole('button', { name: /select theme/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('privacy page has dark mode toggle', async ({ page }) => {
    await page.goto('/privacy', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    await expect(page.getByRole('button', { name: /select theme/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('login page has dark mode toggle', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    await expect(page.getByRole('button', { name: /select theme/i }).first()).toBeVisible({ timeout: 5000 });
  });

  test('about and services pages use the same theme selector', async ({ page }) => {
    for (const path of ['/about', '/services']) {
      await page.goto(path, { waitUntil: 'load', timeout: 60000 });
      await expect(page.getByRole('button', { name: /select theme/i }).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('dark mode persists across public page navigation', async ({ page }) => {
    // Start on landing, enable dark mode
    await page.goto('/', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    await selectTheme(page, 'Dark');
    await page.waitForTimeout(500);
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Navigate to contact — dark mode should still be active
    await page.goto('/contact', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Navigate to privacy — dark mode should still be active
    await page.goto('/privacy', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});

test.describe('Dark Mode — Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('govfleet-theme-test-initialised')) {
        localStorage.removeItem('govfleet-theme');
        sessionStorage.setItem('govfleet-theme-test-initialised', 'true');
      }
    });
    await signIn(page);
  });

  test('dashboard topbar has dark mode toggle', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await selectTheme(page, 'Dark');
    await page.waitForTimeout(500);
    await expect(page.locator('html')).toHaveClass(/dark/);

    await selectTheme(page, 'Light');
    await page.waitForTimeout(500);
    await expect(page.locator('html')).not.toHaveClass(/dark/);
  });

  test('dark mode toggle works on trips page', async ({ page }) => {
    await page.goto('/dashboard/trips', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await selectTheme(page, 'Dark');
    await page.waitForTimeout(500);
    await expect(page.locator('html')).toHaveClass(/dark/);

    // Navigate to fleet — dark mode persists
    await page.goto('/dashboard/fleet', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);
    await expect(page.locator('html')).toHaveClass(/dark/);
  });
});
