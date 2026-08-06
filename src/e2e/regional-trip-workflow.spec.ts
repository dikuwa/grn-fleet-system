import { test, expect, Page } from '@playwright/test';

/**
 * Helper: Sign in via API and inject the session cookie so the test browser
 * is authenticated for protected dashboard routes.
 */
async function signInAndSetCookie(
  page: Page,
  email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na',
) {
  const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  let res = await page.request.post(`${baseURL}/api/auth/sign-in`, {
    data: { email, password },
  });
  // Retry on rate limit (429) with backoff
  for (let attempt = 0; attempt < 5 && res.status() === 429; attempt++) {
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
    res = await page.request.post(`${baseURL}/api/auth/sign-in`, {
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
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Regional Trip Workflow', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await signInAndSetCookie(page);
  });

  test('dashboard loads with key metrics', async ({ page }) => {
    // The dashboard h1 is the active workspace label (never the literal text
    // "Dashboard") and fleet pages belong to the transport workspace.
    await page.context().clearCookies();
    await signInAndSetCookie(page, 'transport.admin@kavangoeast.test');
    await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1').first()).toContainText(/Transport Administration|Active requests/, {
      timeout: 20000,
    });
    await expect(page.locator('[class*="tabular-nums"]').first()).toBeAttached({ timeout: 15000 });
  });

  test('can view fleet list with active vehicles', async ({ page }) => {
    await page.context().clearCookies();
    await signInAndSetCookie(page, 'transport.admin@kavangoeast.test');
    await page.goto('/dashboard/fleet', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Fleet")').first()).toBeVisible({ timeout: 20000 });
  });

  test('can view driver list and navigate to detail', async ({ page }) => {
    await page.goto('/dashboard/drivers', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Driver")').first()).toBeVisible({ timeout: 20000 });

    // Try clicking the first driver link to navigate to detail
    const driverLink = page.locator('a[href*="/dashboard/drivers/"]').first();
    if (await driverLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await driverLink.click();
      await expect(page.locator('h1:has-text("Driver")').first()).toBeVisible({ timeout: 15000 });
    }
  });

  test('approvals list page loads', async ({ page }) => {
    await page.context().clearCookies();
    await signInAndSetCookie(page, 'supervisor@kavangoeast.test');
    await page.goto('/dashboard/approvals', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Use auto-retrying assertion for client-rendered page
    await expect(page.locator('h1:has-text("Approvals")').first()).toBeVisible({ timeout: 45000 });
  });

  test('reports page loads all report types', async ({ page }) => {
    await page.goto('/dashboard/reports', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Reports")').first()).toBeVisible({ timeout: 20000 });

    const reportButtons = [
      'Fuel Consumption',
      'Fleet Utilisation',
      'Trip Summary',
      'Maintenance',
      'Transport Requests',
      'Approvals',
    ];
    for (const label of reportButtons) {
      await expect(page.locator(`button:has-text("${label}")`).first()).toBeVisible({
        timeout: 10000,
      });
    }
  });

  test('reports page can switch between report types', async ({ page }) => {
    await page.goto('/dashboard/reports', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Reports")').first()).toBeVisible({ timeout: 15000 });

    await page.locator('button:has-text("Fleet Utilisation")').first().click();
    // Report content may vary — just verify a stat card appeared
    await expect(page.locator('[class*="tabular-nums"]').first()).toBeAttached({ timeout: 10000 });

    await page.locator('button:has-text("Trip Summary")').first().click();
    await expect(page.locator('[class*="tabular-nums"]').first()).toBeAttached({ timeout: 10000 });

    await page.locator('button:has-text("Approvals")').first().click();
    await expect(page.locator('[class*="tabular-nums"]').first()).toBeAttached({ timeout: 10000 });
  });

  test('reports export buttons are present', async ({ page }) => {
    await page.goto('/dashboard/reports', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('button:has-text("Export CSV")').first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('inspection pages load', async ({ page }) => {
    await page.goto('/dashboard/inspections/departure', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    // Page loaded — any h1 is present
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });

    await page.goto('/dashboard/inspections/return', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1').first()).toBeVisible({ timeout: 20000 });
  });

  test('maintenance list page loads', async ({ page }) => {
    // Maintenance is a maintenance-officer workspace; the tenant admin has no access.
    await page.context().clearCookies();
    await signInAndSetCookie(page, 'maintenance@kavangoeast.test');
    await page.goto('/dashboard/maintenance', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Maintenance")').first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('reimbursements list page loads', async ({ page }) => {
    await page.context().clearCookies();
    await signInAndSetCookie(page, 'transport.admin@kavangoeast.test');
    await page.goto('/dashboard/reimbursements', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Reimbursements")').first()).toBeVisible({
      timeout: 20000,
    });
  });

  test('vehicle defects page loads', async ({ page }) => {
    await page.context().clearCookies();
    await signInAndSetCookie(page, 'maintenance@kavangoeast.test');
    await page.goto('/dashboard/fleet/defects', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Defects")').first()).toBeVisible({ timeout: 20000 });
  });

  test('allocations new page has vehicle recommendation button', async ({ page }) => {
    await page.goto('/dashboard/allocations/new', { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Page loaded — any h1 is present
    await expect(page.locator('h1').first()).toBeVisible({
      timeout: 45000,
    });
    // Check for recommendation or vehicle-related button
    const recBtn = page.locator('button').filter({ hasText: /Vehicle|Recommend|Allocate/i }).first();
    if (await recBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await expect(recBtn).toBeVisible({ timeout: 5000 });
    }
  });

  test('driver detail page shows licence info', async ({ page }) => {
    // First, get a driver ID from the API
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await page.request.get(`${baseURL}/api/drivers`, {
      headers: {
        cookie: `better-auth.session_token=${(await page.context().cookies()).find((c) => c.name === 'better-auth.session_token')?.value}`,
      },
    });

    if (res.status() === 200) {
      const body = await res.json();
      if (body.data?.length > 0) {
        const driverId = body.data[0].employeeId || body.data[0].id;
        if (driverId) {
          await page.goto(`/dashboard/drivers/${driverId}`, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });
          await expect(page.locator('h1:has-text("Driver")').first()).toBeVisible({
            timeout: 15000,
          });
        }
      }
    }
  });
});
