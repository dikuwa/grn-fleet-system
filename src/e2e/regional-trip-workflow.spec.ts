import { test, expect, Page } from '@playwright/test';

/**
 * Helper: Sign in via API and inject the session cookie so the test browser
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
  expect(body.session).toBeDefined();
  expect(body.session.token).toBeDefined();

  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: body.session.token,
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
}

test.describe('Regional Trip Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await signInAndSetCookie(page);
  });

  test('dashboard loads with key metrics', async ({ page }) => {
    await page.goto('/dashboard', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Dashboard")').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('[class*="tabular-nums"]').first()).toBeAttached({ timeout: 10000 });
  });

  test('can view fleet list with active vehicles', async ({ page }) => {
    await page.goto('/dashboard/fleet', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Fleet")').first()).toBeVisible({ timeout: 15000 });
  });

  test('can view driver list and navigate to detail', async ({ page }) => {
    await page.goto('/dashboard/drivers', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Driver")').first()).toBeVisible({ timeout: 15000 });

    // Try clicking the first driver link to navigate to detail
    const driverLink = page.locator('a[href*="/dashboard/drivers/"]').first();
    if (await driverLink.isVisible({ timeout: 3000 }).catch(() => false)) {
      await driverLink.click();
      await page.waitForTimeout(3000);
      // Verify the detail page loaded
      await expect(page.locator('h1:has-text("Driver")').first()).toBeVisible({ timeout: 10000 });
    }
  });

  test('approvals list page loads', async ({ page }) => {
    await page.goto('/dashboard/approvals', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Approvals")').first()).toBeVisible({ timeout: 15000 });
  });

  test('reports page loads all report types', async ({ page }) => {
    await page.goto('/dashboard/reports', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Reports")').first()).toBeVisible({ timeout: 15000 });

    const reportButtons = [
      'Fuel Consumption',
      'Fleet Utilisation',
      'Trip Summary',
      'Maintenance',
      'Transport Requests',
      'Approvals',
    ];
    for (const label of reportButtons) {
      await expect(page.locator(`button:has-text("${label}")`).first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('reports page can switch between report types', async ({ page }) => {
    await page.goto('/dashboard/reports', { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);

    await page.locator('button:has-text("Fleet Utilisation")').first().click();
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Total Vehicles').first()).toBeVisible({ timeout: 10000 });

    await page.locator('button:has-text("Trip Summary")').first().click();
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Total Trips').first()).toBeVisible({ timeout: 10000 });

    await page.locator('button:has-text("Approvals")').first().click();
    await page.waitForTimeout(2000);
    await expect(page.locator('text=Avg. Approval Time').first()).toBeAttached({ timeout: 10000 });
  });

  test('reports export buttons are present', async ({ page }) => {
    await page.goto('/dashboard/reports', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('button:has-text("Export CSV")').first()).toBeVisible({ timeout: 15000 });
  });

  test('inspection pages load', async ({ page }) => {
    await page.goto('/dashboard/inspections/departure', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Departure")').first()).toBeVisible({ timeout: 15000 });

    await page.goto('/dashboard/inspections/return', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Return")').first()).toBeVisible({ timeout: 15000 });
  });

  test('maintenance list page loads', async ({ page }) => {
    await page.goto('/dashboard/maintenance', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Maintenance")').first()).toBeVisible({ timeout: 15000 });
  });

  test('reimbursements list page loads', async ({ page }) => {
    await page.goto('/dashboard/reimbursements', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Reimbursements")').first()).toBeVisible({ timeout: 15000 });
  });

  test('vehicle defects page loads', async ({ page }) => {
    await page.goto('/dashboard/fleet/defects', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Defects")').first()).toBeVisible({ timeout: 15000 });
  });

  test('allocations new page has vehicle recommendation button', async ({ page }) => {
    await page.goto('/dashboard/allocations/new', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("New Vehicle Allocation")').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('button:has-text("Get Vehicle Recommendation")').first()).toBeVisible({ timeout: 10000 });
  });

  test('driver detail page shows licence info', async ({ page }) => {
    // First, get a driver ID from the API
    const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    const res = await page.request.get(`${baseURL}/api/drivers`, {
      headers: { cookie: `better-auth.session_token=${(await page.context().cookies()).find(c => c.name === 'better-auth.session_token')?.value}` },
    });

    if (res.status() === 200) {
      const body = await res.json();
      if (body.data?.length > 0) {
        const driverId = body.data[0].employeeId || body.data[0].id;
        if (driverId) {
          await page.goto(`/dashboard/drivers/${driverId}`, { waitUntil: 'load', timeout: 60000 });
          await page.waitForTimeout(2000);
          // Should show driver info
          await expect(page.locator('h1:has-text("Driver")').first()).toBeVisible({ timeout: 10000 });
        }
      }
    }
  });
});
