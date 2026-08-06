import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
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
 * Read the "Assigned approvals" dashboard card count.  The card label text
 * is unique on the page (the sidebar and shortcuts links use the capitalised
 * "Assigned Approvals"), and the count sits in the paragraph immediately
 * before the label, so no ambiguous container locator is needed.
 */
async function readAssignedApprovalsCount(page: Page) {
  const label = page.getByText('Assigned approvals', { exact: true });
  await expect(label).toBeVisible();
  const count = await label.evaluate((element) => {
    const sibling = element.previousElementSibling;
    return sibling?.textContent ?? '';
  });
  const numeric = Number(count);
  // Guard against a card-layout change breaking the sibling read: fail with
  // a clear message instead of a confusing `NaN >= n` assertion later.
  expect(Number.isFinite(numeric), `Unexpected dashboard count: ${count}`).toBe(true);
  return numeric;
}

/**
 * Create a regional transport request through the public API.  The engine
 * initialises its workflow with permission-routed steps that are never
 * written back to workflowSteps.assignedUserId, so the resulting approval is
 * exactly the case the queue predicate was written for.
 */
async function createPendingRequest(requester: APIRequestContext) {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const response = await requester.post('/api/transport-requests', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      purpose: 'Approval queue E2E field visit',
      scope: 'regional',
      activities: [
        {
          title: 'Field visit',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 120,
        },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const created = await response.json();
  const workflowId = created.request.workflowInstanceId as string;
  const reference = created.request.reference as string;
  expect(workflowId).toBeTruthy();
  expect(reference).toMatch(/^GRN\/TR\//);
  return { workflowId, reference };
}

test('permission-routed approval appears in the supervisor queue and dashboard card', async ({
  browser,
}) => {
  // Capture the supervisor's baseline "Assigned approvals" count so the
  // card increment is asserted relative to the state before our request.
  const supervisorBefore = await login('supervisor@kavangoeast.test');
  const beforeStorage = await supervisorBefore.storageState();
  const beforeContext = await browser.newContext({ storageState: beforeStorage });
  const beforePage = await beforeContext.newPage();
  await beforePage.goto('/dashboard', { waitUntil: 'load' });
  const beforeCount = await readAssignedApprovalsCount(beforePage);
  await beforeContext.close();
  await supervisorBefore.dispose();

  // Create a fresh request — its supervisor step is permission-routed and
  // unassigned in the DB, which the old strict query could never surface.
  const requester = await login('requester@kavangoeast.test');
  const { reference } = await createPendingRequest(requester);
  await requester.dispose();

  // Positive control: the supervisor's queue must list the new approval.
  const supervisor = await login('supervisor@kavangoeast.test');
  const supervisorStorage = await supervisor.storageState();
  const queueContext = await browser.newContext({ storageState: supervisorStorage });
  const queuePage = await queueContext.newPage();
  await queuePage.goto('/dashboard/approvals', { waitUntil: 'load' });
  const row = queuePage.locator('a').filter({ hasText: reference }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await queueContext.close();

  // Dashboard card must have incremented past the baseline.  CI runs with a
  // single worker, so no other spec can create/advance a supervisor approval
  // between the two reads; the reference-presence assertion above is the real
  // regression guard, and this card check is the secondary signal.
  const dashboardContext = await browser.newContext({ storageState: supervisorStorage });
  const dashboardPage = await dashboardContext.newPage();
  await dashboardPage.goto('/dashboard', { waitUntil: 'load' });
  const afterCount = await readAssignedApprovalsCount(dashboardPage);
  expect(afterCount).toBeGreaterThanOrEqual(beforeCount + 1);
  await dashboardContext.close();
  await supervisor.dispose();

  // Negative control: the transport admin decides step 2 but does not hold
  // REQUEST_APPROVE_SUPERVISOR, so a request sitting at supervisor step 1
  // must not leak into their queue.
  const transport = await login('transport.admin@kavangoeast.test');
  const transportStorage = await transport.storageState();
  const transportContext = await browser.newContext({ storageState: transportStorage });
  const transportPage = await transportContext.newPage();
  await transportPage.goto('/dashboard/approvals', { waitUntil: 'load' });
  // Assert the queue page actually rendered before checking absence, so a
  // broken/empty page cannot vacuously satisfy the negative control.
  await expect(transportPage.getByRole('heading', { name: 'Assigned Approvals' })).toBeVisible();
  await expect(transportPage.locator('a').filter({ hasText: reference })).toHaveCount(0);
  await transportContext.close();
  await transport.dispose();
});
