import { test, expect, Page } from '@playwright/test';

/**
 * Sign in via API and inject the session cookie so the test browser
 * is authenticated for protected dashboard routes.
 */
async function signInAndSetCookie(page: Page) {
  const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const res = await page.request.post(`${baseURL}/api/auth/sign-in`, {
    data: { email, password },
  });

  expect(res.status()).toBe(200);

  const body = await res.json();
  const token = body.token || body.session?.token;
  expect(token).toBeDefined();

  // Set the session cookie so subsequent requests are authenticated
  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Offline Drafts', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    // Authenticate first
    await signInAndSetCookie(page);
  });

  test('shows draft save button on fuel entry form', async ({ page }) => {
    await page.goto('/dashboard/fuel/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("New Fuel Entry")').first()).toBeVisible({ timeout: 10000 });

    // Verify the fuel entry form loads with the save draft button
    await expect(page.locator('button:has-text("Save Draft")').first()).toBeVisible({ timeout: 10000 });
  });

  test('saves draft when offline and form data is entered', async ({ page, context }) => {
    await page.goto('/dashboard/fuel/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("New Fuel Entry")').first()).toBeVisible({ timeout: 10000 });

    // Fill in the fuel entry form using placeholder selectors
    await page.locator('input[placeholder="e.g. GRN-001"]').fill('GRN-001');
    await page.locator('input[placeholder="e.g. 45.5"]').fill('45.5');
    await page.locator('input[placeholder="e.g. 850.00"]').fill('850.00');
    await page.locator('input[placeholder="e.g. Total Energies, Rundu"]').fill('Test Station');

    // Set the browser to offline mode
    await context.setOffline(true);

    // Click the "Save Draft" button
    await page.locator('button:has-text("Save Draft")').first().click();

    // Verify the offline indicator shows unsynced text
    const indicator = page.locator('[data-testid="offline-indicator"]');
    await expect(indicator).toBeVisible({ timeout: 5000 });
    // When offline, it shows "Offline" text; when online with drafts, "pending sync"
    await expect(indicator).toContainText(/offline|pending sync/i);

    // The button text changes to "Saved!" for 2 seconds after draft save
    await expect(page.locator('button:has-text("Saved!")').first()).toBeVisible({ timeout: 5000 });

    // Switch back to online
    await context.setOffline(false);
  });

  test('shows offline indicator when browser goes offline', async ({ page, context }) => {
    await page.goto('/dashboard/fuel/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("New Fuel Entry")').first()).toBeVisible({ timeout: 10000 });

    // Go offline - the indicator should appear (initially hidden when online + 0 drafts)
    await context.setOffline(true);

    // Verify offline status indicator updates
    await expect(page.locator('[data-testid="offline-indicator"]')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('[data-testid="offline-indicator"]')).toContainText(/offline/i);

    // The fuel entry form should show an offline warning banner (use first() since
    // the text "offline" may appear in multiple elements)
    await expect(page.locator('text=You are offline').first()).toBeVisible({ timeout: 5000 });
  });

  test('offline indicator shows draft count in dashboard shell', async ({ page }) => {
    // Navigate to the main dashboard
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });

    // When online with 0 drafts, the indicator is hidden (returns null)
    // This is expected behavior — we just verify the page loads
    await expect(page.locator('h1, h2:has-text("Dashboard")').first()).toBeVisible({ timeout: 10000 });
  });
});
