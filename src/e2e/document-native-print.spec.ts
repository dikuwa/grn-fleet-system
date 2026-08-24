import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TRANSPORT_REQUEST_FIXTURE_ID = '10000000-0000-4000-8000-000000000001';

test('browser Print opens the standalone official PDF instead of dashboard chrome', async ({ browser }) => {
  test.setTimeout(180_000);

  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email: 'transport.admin@kavangoeast.test', password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  // The canonical print target is the exact PDF used by preview/download.
  // Validate those bytes independently so this test does not depend on
  // Chromium's internal PDF-viewer DOM implementation.
  const pdfResponse = await api.get(`/api/documents/${TRANSPORT_REQUEST_FIXTURE_ID}/pdf?preview=1`, {
    headers: { Accept: 'application/pdf' },
  });
  expect(pdfResponse.status(), await pdfResponse.text()).toBe(200);
  expect(pdfResponse.headers()['content-type']).toContain('application/pdf');
  const pdfBytes = await pdfResponse.body();
  expect(pdfBytes.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdfBytes.length).toBeGreaterThan(1_000);

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  await page.goto(`/dashboard/documents/${TRANSPORT_REQUEST_FIXTURE_ID}/print`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await expect(page.getByText('Opening document…')).toBeVisible({ timeout: 10_000 });

  // NativeDocumentPrintLauncher fetches the authenticated official PDF and
  // replaces the dashboard route with an object URL. Once this happens there
  // is no dashboard sidebar/header/toast tree available to leak into Print.
  await page.waitForURL((url) => url.protocol === 'blob:', { timeout: 60_000 });
  expect(page.url()).toMatch(/^blob:/);

  await context.close();
  await api.dispose();
});
