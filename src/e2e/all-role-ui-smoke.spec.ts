import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const accounts = [
  { email: 'platform.admin@grnfleet.test', documents: false },
  { email: 'admin@kavangoeast.gov.na', documents: false },
  { email: 'transport.admin@kavangoeast.test', documents: true },
  { email: 'requester@kavangoeast.test', documents: true },
  { email: 'supervisor@kavangoeast.test', documents: false },
  { email: 'release.officer@kavangoeast.test', documents: false },
  { email: 'regional.authoriser@kavangoeast.test', documents: false },
  { email: 'national.release@kavangoeast.test', documents: false },
  { email: 'national.authoriser@kavangoeast.test', documents: false },
  { email: 'driver@kavangoeast.test', documents: true },
  { email: 'inspector@kavangoeast.test', documents: false },
  { email: 'maintenance@kavangoeast.test', documents: false },
  { email: 'auditor@kavangoeast.test', documents: true },
] as const;

async function selectTheme(page: import('@playwright/test').Page, name: 'Dark' | 'Light') {
  const trigger = page.getByRole('button', { name: /select theme/i }).first();
  const option = page.getByRole('menuitemradio', { name });

  await trigger.click();
  try {
    await expect(option, `theme option ${name} should open`).toBeVisible({ timeout: 5_000 });
  } catch {
    // One guarded retry handles a transient Radix/menu animation miss without
    // allowing a broken selector to consume the entire ten-minute role test.
    await page.keyboard.press('Escape').catch(() => undefined);
    await trigger.click();
    await expect(option, `theme option ${name} should open after retry`).toBeVisible({ timeout: 5_000 });
  }
  await option.click();
}

async function expectDarkTheme(page: import('@playwright/test').Page, label: string) {
  await expect(page.locator('html'), `${label} should retain dark theme`).toHaveClass(/dark/);
  expect(await page.evaluate(() => localStorage.getItem('govfleet-theme')), `${label} stored theme`).toBe(
    'dark',
  );
}

test.describe.serial('Every seeded role — responsive, theme, notification and document matrix', () => {
  test.setTimeout(180_000);

  for (const account of accounts) {
    test(`${account.email} receives only its intended personal workspace capabilities`, async ({ browser }) => {
      const api = await playwrightRequest.newContext({ baseURL: BASE });
      const signIn = await api.post('/api/auth/sign-in', {
        data: { email: account.email, password: PASSWORD },
      });
      expect(signIn.status(), `sign in ${account.email}`).toBe(200);

      const context = await browser.newContext({
        storageState: await api.storageState(),
        viewport: { width: 390, height: 844 },
      });
      const page = await context.newPage();
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expect(page).toHaveURL(/\/dashboard/);
      await expect(page.getByRole('button', { name: /select theme/i }).first()).toBeVisible();
      await expect(page.getByRole('link', { name: /notifications/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /open search/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /open account menu/i }).first()).toBeVisible();

      // Exercise the real theme selector for every role rather than merely
      // asserting that the trigger exists. Keep dark mode active while visiting
      // personal routes so route transitions cannot silently fall back to light.
      await selectTheme(page, 'Dark');
      await expectDarkTheme(page, `${account.email} dashboard`);

      // Notifications are a personal route for every workspace. Verify the
      // actual page in dark mode rather than only the navigation link.
      const notifications = await page.goto('/dashboard/notifications', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      expect(notifications?.status(), `${account.email} notifications response`).toBe(200);
      await expect(page).toHaveURL(/\/dashboard\/notifications/);
      await expectDarkTheme(page, `${account.email} notifications`);

      // Documents intentionally belong only to PERSONAL, DRIVER,
      // TRANSPORT_ADMIN and AUDIT workspaces. Verify both sides of that matrix
      // while dark mode is active so restricted-route handling cannot reset the
      // user's persisted theme either.
      const documents = await page.goto('/dashboard/documents', {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      });
      if (account.documents) {
        expect(documents?.status(), `${account.email} documents response`).toBe(200);
        await expect(page).toHaveURL(/\/dashboard\/documents/);
        await expectDarkTheme(page, `${account.email} documents`);
      } else {
        const status = documents?.status() ?? 0;
        const stillOnDocuments = /\/dashboard\/documents(?:\/|$)/.test(page.url());
        expect(
          status === 403 || status === 404 || !stillOnDocuments,
          `${account.email} must not gain Documents workspace access`,
        ).toBe(true);
        await expectDarkTheme(page, `${account.email} restricted documents navigation`);
      }

      // Return to the role dashboard and prove the opposite theme transition
      // still works after cross-route navigation.
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await expectDarkTheme(page, `${account.email} dashboard return`);
      await selectTheme(page, 'Light');
      await expect(page.locator('html')).not.toHaveClass(/dark/);
      expect(await page.evaluate(() => localStorage.getItem('govfleet-theme'))).toBe('light');

      const dimensions = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(dimensions.content, `${account.email} horizontal overflow`).toBeLessThanOrEqual(
        dimensions.viewport + 5,
      );

      await context.close();
      await api.dispose();
    });
  }
});
