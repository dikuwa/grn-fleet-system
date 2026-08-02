import AxeBuilder from '@axe-core/playwright';
import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

test.describe.configure({ timeout: 120_000 });

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  let lastStatus = 0;
  let lastBody = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
    lastStatus = response.status();
    lastBody = await response.text();
    if (lastStatus === 200) return api;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  expect(lastStatus, lastBody).toBe(200);
  return api;
}

async function openFirstAssignedApproval(page: Page, knownPath?: string) {
  if (knownPath) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await page.goto(knownPath, { waitUntil: 'load' });
      const summary = page.getByRole('heading', { name: 'Request Decision Summary' });
      if (await summary.isVisible().catch(() => false)) {
        await page.waitForTimeout(500);
        return;
      }
      await page.waitForTimeout(500);
    }
    await expect(page.getByRole('heading', { name: 'Request Decision Summary' })).toBeVisible();
    return;
  }
  await page.goto('/dashboard/approvals', { waitUntil: 'load' });
  const link = page
    .locator('a[href^="/dashboard/approvals/"]')
    .filter({ hasText: /GRN\// })
    .first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toBeTruthy();
  await page.goto(href!, { waitUntil: 'load' });
  await expect(page.getByRole('heading', { name: 'Request Decision Summary' })).toBeVisible();
  await page.waitForTimeout(500);
}

async function expectNoPageOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  expect(dimensions.page).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('supervisor can review a complete decision workspace and contextual action panel on mobile', async ({
  browser,
}) => {
  const api = await login('supervisor@kavangoeast.test');
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await openFirstAssignedApproval(
    page,
    '/dashboard/approvals/e71bed4c-0132-4c43-b50b-440b3c0554d0',
  );
  await expectNoPageOverflow(page);

  const title = await page.getByRole('heading', { level: 1 }).textContent();
  expect(title).not.toMatch(/^GRN\//);
  await expect(page.getByText(/Transport Request · GRN\//)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Decision Brief' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand request details' }).click();
  for (const section of [
    'Journey',
    'Purpose & Programme',
    'People',
    'Vehicle & Logistics',
    'Approval Context',
  ]) {
    await expect(page.getByRole('heading', { name: section })).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Alerts and Checks' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Workflow Timeline' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Action History' })).toBeVisible();

  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = axe.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(blocking, blocking.map((violation) => violation.id).join(', ')).toEqual([]);

  const actionHref = await page
    .getByRole('link', { name: 'Review & Take Action' })
    .first()
    .getAttribute('href');
  expect(actionHref).toBeTruthy();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(actionHref!, { waitUntil: 'load' });
    if (
      await page
        .getByRole('heading', { name: /Decision:/ })
        .isVisible()
        .catch(() => false)
    ) {
      break;
    }
    await page.waitForTimeout(500);
  }
  await expect(page.getByRole('heading', { name: /Decision:/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What you are deciding' })).toBeVisible();
  await page.getByRole('radio', { name: /Reject/ }).click();
  await expect(page.getByLabel('Decision comment')).toHaveAttribute('aria-required', 'true');
  await expect(page.getByRole('button', { name: 'Confirm Decision' })).toBeDisabled();
  await page.getByLabel('Decision comment').fill('The supporting itinerary needs correction.');
  await expect(page.getByRole('button', { name: 'Confirm Decision' })).toBeEnabled();
  await expectNoPageOverflow(page);
  await context.close();
  await api.dispose();
});

test('decision workspace remains contained on desktop dark mode', async ({ browser }) => {
  const api = await login('transport.admin@kavangoeast.test');
  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.setItem('govfleet-theme', 'dark'));
  await openFirstAssignedApproval(
    page,
    '/dashboard/approvals/3cdf9ab3-b507-42a9-a296-85b310d39c4e',
  );
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Expand request details' }).click();
  await expect(page.getByRole('heading', { name: 'Journey' })).toBeVisible();
  await expectNoPageOverflow(page);
  await context.close();
  await api.dispose();
});
