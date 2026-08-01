import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

test.describe('Employee lifecycle and secure request surfaces', () => {
  test('secure employee request is public, private-by-default, responsive, and theme aware', async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();

    await page.goto('/request/kavango-east', { waitUntil: 'domcontentloaded' });

    await expect(page).toHaveURL(/\/request\/kavango-east$/);
    // SSR page: allow time for the initial cold render on first navigation.
    await expect(page.getByRole('heading', { name: 'Employee transport request' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: /select theme/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(/same response is shown whether or not/i)).toBeVisible({
      timeout: 10_000,
    });

    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport + 5);

    // Use a unique verifier each run to avoid rate-limit collisions
    const uniqueVerifier = `nobody-${Date.now()}@example.invalid`;
    await page.locator('input[name="employeeNumber"]').fill('DOES-NOT-EXIST');
    await page.locator('input[name="verifier"]').fill(uniqueVerifier);

    // Click submit and wait for the API response
    const otpResponse = page.waitForResponse(
      (r) => r.url().includes('/api/public/requests/kavango-east/otp') && r.request().method() === 'POST',
    );
    await page.getByRole('button', { name: /send one-time code/i }).click();
    await otpResponse;

    // Should show an error alert — the Next.js route announcer also has role=alert so use a specific text match
    await expect(page.getByText(/could not verify|too many attempts/i)).toBeVisible({ timeout: 10_000 });

    await context.close();
  });

  test('tenant administrator can open lifecycle and delegation workspaces', async ({ browser }) => {
    const api = await playwrightRequest.newContext({ baseURL: BASE });
    const signIn = await api.post('/api/auth/sign-in', {
      data: { email: 'admin@kavangoeast.gov.na', password: PASSWORD },
    });
    expect(signIn.status()).toBe(200);

    const context = await browser.newContext({
      storageState: await api.storageState(),
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();

    await page.goto('/dashboard/staff', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /staff directory/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /add employee/i }).first()).toBeVisible();

    await page.goto('/dashboard/delegations', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /acting roles/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /new appointment/i })).toBeVisible();

    await context.close();
    await api.dispose();
  });
});
