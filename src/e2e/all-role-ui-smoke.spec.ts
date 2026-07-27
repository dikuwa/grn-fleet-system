import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const accounts = [
  'platform.admin@grnfleet.test',
  'admin@kavangoeast.gov.na',
  'transport.admin@kavangoeast.test',
  'requester@kavangoeast.test',
  'supervisor@kavangoeast.test',
  'release.officer@kavangoeast.test',
  'regional.authoriser@kavangoeast.test',
  'national.release@kavangoeast.test',
  'national.authoriser@kavangoeast.test',
  'driver@kavangoeast.test',
  'inspector@kavangoeast.test',
  'maintenance@kavangoeast.test',
  'auditor@kavangoeast.test',
] as const;

test.describe.serial('Every seeded role — responsive shell smoke', () => {
  test.setTimeout(300_000);

  for (const email of accounts) {
    test(`${email} receives the responsive, theme-aware dashboard shell`, async ({ browser }) => {
      const api = await playwrightRequest.newContext({ baseURL: BASE });
      const signIn = await api.post('/api/auth/sign-in', {
        data: { email, password: PASSWORD },
      });
      expect(signIn.status(), `sign in ${email}`).toBe(200);

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

      const dimensions = await page.evaluate(() => ({
        content: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(dimensions.content, `${email} horizontal overflow`).toBeLessThanOrEqual(
        dimensions.viewport + 5,
      );

      await context.close();
      await api.dispose();
    });
  }
});
