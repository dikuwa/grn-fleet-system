import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TRANSPORT_REQUEST_FIXTURE_ID = '10000000-0000-4000-8000-000000000001';

test('browser print media renders the official document without dashboard chrome or overlays', async ({
  browser,
}) => {
  test.setTimeout(180_000);

  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email: 'transport.admin@kavangoeast.test', password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.goto(`/dashboard/documents/${TRANSPORT_REQUEST_FIXTURE_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await expect(page.getByTestId('human-readable-document')).toBeVisible();

  await page.emulateMedia({ media: 'print' });

  // Chromium now applies the exact @media print rules used by browser Print.
  // Dashboard chrome and transient overlays must not enter the printed output.
  for (const selector of [
    '.app-sidebar',
    '#app-sidebar',
    '.app-header',
    '#app-header',
    '#app-drawer',
    '.mobile-bottom-nav',
    '.toast-container',
    '.toaster',
  ]) {
    const nodes = page.locator(selector);
    for (let index = 0; index < (await nodes.count()); index += 1) {
      await expect(nodes.nth(index), `print-hidden ${selector}`).toBeHidden();
    }
  }

  await expect(page.getByTestId('human-readable-document')).toBeVisible();
  const printColours = await page.evaluate(() => ({
    bodyBackground: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    overflowX: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  }));
  expect(printColours.bodyBackground).toBe('rgb(255, 255, 255)');
  expect(printColours.overflowX).toBe(true);

  // page.pdf() uses Chromium's native print pipeline; a valid PDF here proves
  // the print stylesheet can be consumed without leaking a runtime failure.
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  expect(pdf.length).toBeGreaterThan(1_000);

  await context.close();
  await api.dispose();
});
