/**
 * Active Trips & UI Smoke — End-to-End Tests
 *
 * Verifies:
 *   1. Active trips page loads with status breakdown
 *   2. Duration component renders for in-progress trips
 *   3. Key dashboard pages load without errors
 *   4. Inspection pages (departure/return/templates) are accessible
 *   5. Expiry alerts dashboard loads
 *   6. Compliance page loads
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

test.describe('Active Trips Tracking', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('active trips page loads with status stats', async ({ page }) => {
    await page.goto('/dashboard/trips/active', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Page header should be visible
    await expect(page.locator('h1:has-text("Active Trips")').first()).toBeVisible({ timeout: 15000 });

    // Should show at least one stat card (in progress, return due, etc.)
    const statCards = page.locator('[class*="tabular-nums"]');
    const count = await statCards.count();
    // There should be 4 stat cards (in progress, return due, return insp, closure review)
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('active trips list shows trip cards with duration', async ({ page }) => {
    await page.goto('/dashboard/trips/active', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Check for trip cards (the linked blocks with make/model)
    const tripCards = page.locator('a[href*="/dashboard/trips/"]');
    const cardCount = await tripCards.count();

    if (cardCount > 0) {
      // At least one trip card exists — verify duration component renders
      await expect(tripCards.first()).toBeVisible({ timeout: 5000 });

      // Duration should show a clock icon and time text
      const clockIcons = page.locator('.lucide-clock');
      if (await clockIcons.count() > 0) {
        await expect(clockIcons.first()).toBeVisible({ timeout: 5000 });
      }
    } else {
      // No active trips — empty state should show
      const emptyState = page.locator('text=No Active Trips');
      await expect(emptyState).toBeVisible({ timeout: 5000 });
    }
  });

  test('active trips page link navigates to trip detail', async ({ page }) => {
    await page.goto('/dashboard/trips/active', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    // Click first trip card if any exist (exclude the "All Trips" button)
    const tripCard = page.locator('a[href*="/dashboard/trips/"]:not(:has-text("All Trips"))').first();
    if (await tripCard.isVisible({ timeout: 3000 }).catch(() => false)) {
      await tripCard.click();
      await page.waitForTimeout(3000);
      // Should navigate to trip detail (URL contains trip ID)
      expect(page.url()).toContain('/dashboard/trips/');
      expect(page.url()).not.toContain('/active');
    }
  });
});

test.describe('Dashboard UI Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('inspections list page loads', async ({ page }) => {
    await page.goto('/dashboard/inspections', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
  });

  test('departure inspection page loads', async ({ page }) => {
    await page.goto('/dashboard/inspections/departure', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1:has-text("Departure")').first()).toBeVisible({ timeout: 15000 });
  });

  test('return inspection page loads', async ({ page }) => {
    await page.goto('/dashboard/inspections/return', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1:has-text("Return")').first()).toBeVisible({ timeout: 15000 });
  });

  test('inspection templates page loads', async ({ page }) => {
    await page.goto('/dashboard/inspections/templates', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
  });

  test('expiry alerts dashboard loads', async ({ page }) => {
    await page.goto('/dashboard/expiry-alerts', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1:has-text("Expiry")').first()).toBeVisible({ timeout: 15000 });
  });

  test('vehicle compliance page loads', async ({ page }) => {
    await page.goto('/dashboard/fleet/compliance', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1:has-text("Compliance")').first()).toBeVisible({ timeout: 15000 });
  });

  test('vehicle defects page loads', async ({ page }) => {
    await page.goto('/dashboard/fleet/defects', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1:has-text("Defects")').first()).toBeVisible({ timeout: 15000 });
  });

  test('driver mobile view loads', async ({ page }) => {
    await page.goto('/dashboard/driver-mobile', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
  });

  test('driver self-service page loads', async ({ page }) => {
    await page.goto('/dashboard/driver-self-service', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });
  });

  test('audit log page loads', async ({ page }) => {
    await page.goto('/dashboard/audit', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1:has-text("Audit")').first()).toBeVisible({ timeout: 15000 });
  });

  test('notifications page loads', async ({ page }) => {
    await page.goto('/dashboard/notifications', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    await expect(page.locator('h1:has-text("Notification")').first()).toBeVisible({ timeout: 15000 });
  });
});
