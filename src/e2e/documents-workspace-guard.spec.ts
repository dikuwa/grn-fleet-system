import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

/**
 * Document workspace guard E2E.
 *
 * `/dashboard/documents` (and its `/dashboard/documents/[id]` detail pages,
 * which share the same route registry entry) is granted to the PERSONAL,
 * DRIVER, TRANSPORT_ADMIN and AUDIT workspaces only. This spec verifies the
 * navigation surface and direct-URL enforcement for one allowed and one
 * denied account per workspace class, including the notable negative: the
 * Tenant Administrator workspace is intentionally NOT granted document
 * access (documents are operational).
 */
const matrix = [
  // Allowed workspaces
  { username: 'requester', email: 'requester@kavangoeast.test', allowed: true },
  { username: 'driver', email: 'driver@kavangoeast.test', allowed: true },
  { username: 'transport-admin', email: 'transport.admin@kavangoeast.test', allowed: true },
  { username: 'auditor', email: 'auditor@kavangoeast.test', allowed: true },
  // Denied workspaces
  { username: 'supervisor', email: 'supervisor@kavangoeast.test', allowed: false },
  { username: 'maintenance', email: 'maintenance@kavangoeast.test', allowed: false },
  { username: 'inspector', email: 'inspector@kavangoeast.test', allowed: false },
  { username: 'tenant-admin', email: 'admin@kavangoeast.gov.na', allowed: false },
] as const;

const DOCUMENTS_PATH = '/dashboard/documents';

test.describe.serial('documents workspace guard', () => {
  test.setTimeout(300_000);

  for (const account of matrix) {
    test(`${account.email} ${account.allowed ? 'sees' : 'is denied'} the documents workspace`, async ({
      browser,
    }) => {
      const api = await playwrightRequest.newContext({ baseURL: BASE });
      const usernameSignIn = await api.post('/api/auth/custom-sign-in', {
        data: { username: account.username, password: PASSWORD },
      });
      expect(usernameSignIn.status(), `${account.username} username login`).toBe(200);
      const signIn = await api.post('/api/auth/sign-in', {
        data: { email: account.email, password: PASSWORD },
      });
      expect(signIn.status(), await signIn.text()).toBe(200);

      const context = await browser.newContext({
        storageState: await api.storageState(),
        viewport: { width: 1280, height: 800 },
      });
      const page = await context.newPage();
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });

      if (account.allowed) {
        await expect(page.locator(`a[href="${DOCUMENTS_PATH}"]`).first()).toBeVisible();
        const allowedResponse = await page.goto(DOCUMENTS_PATH, { waitUntil: 'domcontentloaded' });
        expect(allowedResponse?.status()).toBeLessThan(400);
        expect(page.url()).toContain(DOCUMENTS_PATH);
      } else {
        await expect(page.locator(`a[href="${DOCUMENTS_PATH}"]`)).toHaveCount(0);
        const deniedResponse = await page.goto(DOCUMENTS_PATH, { waitUntil: 'domcontentloaded' });
        const deniedByStatus = (deniedResponse?.status() || 200) >= 400;
        const deniedByRedirect = page.url().includes('/forbidden');
        expect(deniedByStatus || deniedByRedirect).toBe(true);
      }

      await context.close();
      await api.dispose();
    });
  }
});
