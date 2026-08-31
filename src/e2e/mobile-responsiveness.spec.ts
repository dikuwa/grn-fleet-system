import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), await response.text()).toBe(200);
  return api;
}

async function expectNoPageOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    width: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.width + 1);
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
  { width: 480, height: 900 },
  { width: 600, height: 960 },
  { width: 768, height: 1024 },
  { width: 820, height: 1180 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`tenant administration shell reflows at ${viewport.width}px`, async ({ browser }) => {
    const api = await login('admin@kavangoeast.gov.na');
    const context = await browser.newContext({ storageState: await api.storageState(), viewport });
    const page = await context.newPage();
    await page.goto('/dashboard/admin/users', { waitUntil: 'load' });
    await page.waitForTimeout(300);
    await expectNoPageOverflow(page);

    if (viewport.width < 768) {
      await expect(page.getByRole('navigation', { name: 'Quick navigation' })).toBeVisible();
      await page.getByRole('button', { name: 'Open navigation menu' }).click();
      await expect(page.getByRole('dialog', { name: 'Navigation menu' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Navigation menu' })).not.toBeVisible();
    }
    await context.close();
    await api.dispose();
  });
}

test('request and import steppers use compact mobile progress', async ({ browser }) => {
  const requester = await login('requester@kavangoeast.test');
  const context = await browser.newContext({
    storageState: await requester.storageState(),
    viewport: { width: 320, height: 568 },
  });
  const page = await context.newPage();
  await page.goto('/dashboard/requests/new', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Step 1 of 5')).toBeVisible();
  await expectNoPageOverflow(page);
  await context.close();
  await requester.dispose();

  const transport = await login('transport.admin@kavangoeast.test');
  const transportContext = await browser.newContext({
    storageState: await transport.storageState(),
    viewport: { width: 320, height: 568 },
  });
  const importPage = await transportContext.newPage();
  await importPage.goto('/dashboard/fleet/import', { waitUntil: 'domcontentloaded' });
  await expect(importPage.getByText('Step 1 of 4')).toBeVisible();
  await expect(importPage.locator('#vehicle-import-file')).toBeAttached();
  await expectNoPageOverflow(importPage);
  await transportContext.close();
  await transport.dispose();
});

test('invite dialog and employee search stay inside a 320px viewport', async ({ browser }) => {
  const api = await login('admin@kavangoeast.gov.na');
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 320, height: 568 },
  });
  const page = await context.newPage();
  await page.goto('/dashboard/admin/users', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /invite user/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('combobox', { name: 'Search active staff' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search active staff' })).toBeVisible();
  await expectNoPageOverflow(page);
  await context.close();
  await api.dispose();
});

test('mobile administration has no serious WCAG A/AA violations', async ({ browser }) => {
  const api = await login('admin@kavangoeast.gov.na');
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto('/dashboard/admin/users', { waitUntil: 'load' });
  await page.waitForTimeout(300);
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = results.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(blocking, blocking.map((violation) => violation.id).join(', ')).toEqual([]);
  await context.close();
  await api.dispose();
});
