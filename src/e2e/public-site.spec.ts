/**
 * Public Website Regression — End-to-End Test
 *
 * Guards the public marketing site against regressions:
 *   - homepage hero headline, CTAs and the product preview visual render
 *   - every primary nav destination loads for anonymous visitors (proxy
 *     allowlist regression — new public routes must never redirect to /login)
 *   - the /request-demo conversion form completes end to end
 *   - /faq renders its hero for anonymous visitors
 *   - the mobile menu exposes the same navigation links
 *   - the authenticated dashboard stays auth-gated
 *
 * Runs against a fresh dev build (webServer seeds the e2e database).
 */
import { expect, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

test.describe('Public website regression', () => {
  test.setTimeout(120_000);

  test('homepage hero renders headline, CTAs and the product preview', async ({ page }) => {
    await page.goto('/');

    await expect(
      page.getByRole('heading', { level: 1 }),
    ).toContainText('Smarter Fleet Operations');

    await expect(page.getByRole('link', { name: 'Request a Demo' }).first()).toBeVisible();
    // Sign In appears in both the header and the hero CTA row.
    await expect(page.getByRole('link', { name: 'Sign In' }).first()).toBeVisible();

    // The hero's dashboard-style product preview (SHOW THE PRODUCT).
    await expect(page.getByText('Pending Approvals', { exact: true }).first()).toBeVisible();
  });

  test('primary nav pages are public and render header + footer', async ({ page }) => {
    const publicPages = ['/about', '/services', '/faq', '/contact', '/request-demo'];

    for (const path of publicPages) {
      await page.goto(path);

      // Never redirected to /login — the proxy allowlist must include these routes.
      await expect(page).toHaveURL(new RegExp(`${escapeRegExp(BASE)}${escapeRegExp(path)}$`));

      // Shared chrome: brand link in the header and the footer.
      await expect(page.getByRole('link', { name: /— home$/ })).toBeVisible();
      await expect(page.locator('footer')).toBeVisible();
    }
  });

  test('request-demo form completes end to end', async ({ page }) => {
    await page.goto('/request-demo');

    await page.locator('#demo-name').fill('E2E Visitor');
    await page.locator('#demo-organisation').fill('E2E Test Organisation');
    await page.locator('#demo-org-type').selectOption({ label: 'Regional Council' });
    await page.locator('#demo-email').fill(`e2e.visitor.${Date.now()}@example.org`);
    await page.locator('#demo-phone').fill('+264 81 000 0000');
    // '26–50' is index 2 of the fleet-size options (1–10, 11–25, 26–50, …).
    await page.locator('#demo-fleet-size').selectOption({ index: 2 });
    await page.locator('#demo-message').fill('E2E regression test submission.');

    await page.getByRole('button', { name: 'Request a Demo' }).click();

    await expect(
      page.getByRole('heading', { name: 'Demo request received' }),
    ).toBeVisible();
  });

  test('FAQ page renders for anonymous visitors', async ({ page }) => {
    await page.goto('/faq');

    await expect(
      page.getByRole('heading', { name: 'Frequently Asked Questions' }),
    ).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
  });

  test('mobile menu exposes the same navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await page.getByRole('button', { name: 'Open menu' }).click();

    const menu = page.getByRole('dialog');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('link', { name: 'About' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Contact' })).toBeVisible();
    await expect(menu.getByRole('link', { name: 'Request Demo' }).first()).toBeVisible();
  });

  test('dashboard remains auth-gated for anonymous visitors', async ({ page }) => {
    await page.goto('/dashboard');

    // Anonymous visitors are redirected to the login page, not served the app.
    await expect(page).toHaveURL(/\/login/);
  });
});

/** Escape a string for use inside a RegExp literal. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
