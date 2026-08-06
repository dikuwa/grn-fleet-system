import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type Page,
} from '@playwright/test';

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

/**
 * Create a regional transport request through the public API and return its
 * workflow instance id.  The seeded database never carries fixed approval
 * request UUIDs, so the workspace tests must provision their own pending
 * approval instead of navigating to a hardcoded id.
 */
async function createPendingApproval(requester: APIRequestContext) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const response = await requester.post('/api/transport-requests', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      purpose: 'Approval decision workspace E2E field visit',
      scope: 'regional',
      activities: [
        {
          title: 'Field visit',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 180,
        },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const created = await response.json();
  const workflowId = created.request.workflowInstanceId as string;
  expect(workflowId).toBeTruthy();
  return workflowId;
}

async function approve(api: APIRequestContext, workflowId: string) {
  const response = await api.post(`/api/approvals/${workflowId}/action`, {
    data: { actionType: 'approved' },
  });
  expect(response.status(), await response.text()).toBe(200);
}

async function openApproval(
  browser: Browser,
  email: string,
  workflowId: string,
  viewport: { width: number; height: number },
  initScript?: () => void,
) {
  const api = await login(email);
  const storageState = await api.storageState();
  const context = await browser.newContext({ storageState, viewport });
  if (initScript) await context.addInitScript(initScript);
  const page = await context.newPage();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(`/dashboard/approvals/${workflowId}`, { waitUntil: 'load' });
    } catch {
      // A stale server or transient SSR hiccup can abort the navigation;
      // retry the goto itself rather than only re-checking the heading.
      await page.waitForTimeout(750);
      continue;
    }
    const summary = page.getByRole('heading', { name: 'Request Summary' });
    if (await summary.isVisible().catch(() => false)) {
      await page.waitForTimeout(500);
      return { api, context, page };
    }
    await page.waitForTimeout(500);
  }
  await expect(page.getByRole('heading', { name: 'Request Summary' })).toBeVisible();
  return { api, context, page };
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
  const requester = await login('requester@kavangoeast.test');
  const workflowId = await createPendingApproval(requester);
  await requester.dispose();

  const { api, context, page } = await openApproval(
    browser,
    'supervisor@kavangoeast.test',
    workflowId,
    { width: 390, height: 844 },
  );
  await expectNoPageOverflow(page);
  const mobileAction = page.getByTestId('mobile-approval-action');
  await expect(mobileAction).toBeVisible();
  await expect(mobileAction).toHaveCSS('position', 'fixed');
  const actionBox = await mobileAction.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { top: box.top, bottom: box.bottom };
  });
  expect(actionBox.top).toBeGreaterThan(0);
  expect(actionBox.bottom).toBeLessThanOrEqual(844 - 56);

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

  // The axe scan scopes to the workspace testid; assert it is actually in the
  // DOM first so an empty include set cannot vacuously pass the scan.
  await expect(page.getByTestId('approval-decision-workspace')).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .include('[data-testid="approval-decision-workspace"]')
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
  const requester = await login('requester@kavangoeast.test');
  const workflowId = await createPendingApproval(requester);
  await requester.dispose();

  // Advance the request past Supervisor Approval so it sits at Transport
  // Review — the step the transport administrator decides.
  const supervisor = await login('supervisor@kavangoeast.test');
  await approve(supervisor, workflowId);
  await supervisor.dispose();

  const { api, context, page } = await openApproval(
    browser,
    'transport.admin@kavangoeast.test',
    workflowId,
    { width: 1440, height: 900 },
    () => localStorage.setItem('govfleet-theme', 'dark'),
  );
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.getByRole('button', { name: 'Expand request details' }).click();
  await expect(page.getByRole('heading', { name: 'Journey' })).toBeVisible();
  const detailColumns = await page
    .getByTestId('approval-request-details')
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length);
  expect(detailColumns).toBe(5);
  await expectNoPageOverflow(page);
  // Same guard as the supervisor test: confirm the axe include target exists.
  await expect(page.getByTestId('approval-decision-workspace')).toBeVisible();
  const axe = await new AxeBuilder({ page })
    .include('[data-testid="approval-decision-workspace"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const blocking = axe.violations.filter(
    (violation) => violation.impact === 'critical' || violation.impact === 'serious',
  );
  expect(blocking, blocking.map((violation) => violation.id).join(', ')).toEqual([]);
  await context.close();
  await api.dispose();
});
