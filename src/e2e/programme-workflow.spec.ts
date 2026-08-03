import {
  test,
  expect,
  request as playwrightRequest,
  type Browser,
} from '@playwright/test';
import { getDb } from '@/db';
import { auditEvents, notifications, transportRequests } from '@/db/schema';
import { programmes } from '@/db/schema/programmes';
import { and, eq } from 'drizzle-orm';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const accounts = {
  tenantAdmin: 'admin@kavangoeast.gov.na',
  requester: 'requester@kavangoeast.test',
  transport: 'transport.admin@kavangoeast.test',
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), `login ${email}`).toBe(200);
  return api;
}

async function openAs(browser: Browser, email: string, path: string) {
  const api = await login(email);
  const storageState = await api.storageState();
  const context = await browser.newContext({ storageState });
  const page = await context.newPage();
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  return { api, context, page };
}

test.describe.serial('Programme business model workflow', () => {
  test.setTimeout(300_000);

  test('programme lifecycle: draft → submitted → approved → published, then links to a transport request', async ({
    browser,
  }) => {
    const requester = await login(accounts.requester);
    const tenantAdmin = await login(accounts.tenantAdmin);

    // 1. Requester creates a programme draft
    const start = new Date(Date.now() + 30 * 86_400_000);
    const end = new Date(start.getTime() + 5 * 86_400_000);
    const createResponse = await requester.post('/api/programmes', {
      data: {
        title: 'E2E Regional Inspection Programme',
        description: 'End-to-end test of the programme lifecycle',
        purpose: 'Regional inspection visits',
        department: 'Transport',
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        venue: 'Regional offices',
        expectedParticipants: 8,
        estimatedKilometres: 450,
      },
    });
    expect(createResponse.status(), await createResponse.text()).toBe(200);
    const created = (await createResponse.json()).data as {
      id: string;
      reference: string;
      status: string;
    };
    expect(created.id).toBeTruthy();
    expect(created.reference).toMatch(/^GRN\/PGM\//);
    expect(created.status).toBe('draft');

    // 2. Creator cannot approve their own programme (COI)
    const coiApprove = await requester.post(`/api/programmes/${created.id}/action`, {
      data: { action: 'approve' },
    });
    // Either 403 (permission) or 409 (COI) — but never 200
    expect([403, 409]).toContain(coiApprove.status());

    // 3. Requester submits the programme
    const submit = await requester.post(`/api/programmes/${created.id}/action`, {
      data: { action: 'submit' },
    });
    expect(submit.status(), await submit.text()).toBe(200);
    expect(((await submit.json()).data as { status: string }).status).toBe('submitted');

    // 4. Tenant Administrator approves
    const approve = await tenantAdmin.post(`/api/programmes/${created.id}/action`, {
      data: { action: 'approve', note: 'Approved for regional programme' },
    });
    expect(approve.status(), await approve.text()).toBe(200);
    expect(((await approve.json()).data as { status: string }).status).toBe('approved');

    // 5. Tenant Administrator publishes
    const publish = await tenantAdmin.post(`/api/programmes/${created.id}/action`, {
      data: { action: 'publish' },
    });
    expect(publish.status(), await publish.text()).toBe(200);
    expect(((await publish.json()).data as { status: string }).status).toBe('published');

    // 6. Published programme is selectable for transport requests
    const selectable = await requester.get('/api/programmes?selectable=1&limit=100');
    expect(selectable.status()).toBe(200);
    const selectableBody = await selectable.json();
    const rows = selectableBody.data as Array<{ id: string; status: string }>;
    expect(rows.some((row) => row.id === created.id && row.status === 'published')).toBe(true);

    // 7. Create a transport request linked to the programme
    const requestResponse = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'Transport for E2E Regional Inspection Programme',
        scope: 'regional',
        programmeId: created.id,
        activities: [
          {
            title: 'Inspection visits',
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            estimatedKilometres: 450,
          },
        ],
      },
    });
    expect(requestResponse.status(), await requestResponse.text()).toBe(200);
    const requestBody = await requestResponse.json();
    const requestId = requestBody.request?.id as string;
    expect(requestId).toBeTruthy();

    // 8. Persistence checks: programme state + linked request + audit + notifications
    const db = getDb();
    const [savedProgramme] = await db
      .select()
      .from(programmes)
      .where(eq(programmes.id, created.id))
      .limit(1);
    const [savedRequest] = await db
      .select()
      .from(transportRequests)
      .where(eq(transportRequests.id, requestId))
      .limit(1);
    const programmeAudits = await db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, 'programme'),
          eq(auditEvents.entityId, created.id),
        ),
      );
    const programmeNotifications = await db
      .select()
      .from(notifications)
      .where(eq(notifications.entityId, created.id));

    expect(savedProgramme.status).toBe('published');
    expect(savedProgramme.approvedAt).toBeTruthy();
    expect(savedProgramme.publishedAt).toBeTruthy();
    expect(savedRequest.programmeId).toBe(created.id);
    expect(
      programmeAudits.some((event) => event.action === 'programme.submit'),
    ).toBe(true);
    expect(
      programmeAudits.some((event) => event.action === 'programme.approve'),
    ).toBe(true);
    expect(
      programmeAudits.some((event) => event.action === 'programme.publish'),
    ).toBe(true);
    expect(programmeNotifications.length).toBeGreaterThan(0);

    // 9. UI smoke: programme list + detail pages render
    const programmesUi = await openAs(browser, accounts.tenantAdmin, '/dashboard/programmes');
    await expect(programmesUi.page).toHaveURL(/\/dashboard\/programmes/);
    await expect(
      programmesUi.page.locator('body').first(),
    ).toBeVisible();
    await programmesUi.page.screenshot({
      path: 'docs/screenshots/programme-list.png',
      fullPage: true,
    });
    await programmesUi.context.close();
    await programmesUi.api.dispose();

    const programmeDetailUi = await openAs(
      browser,
      accounts.tenantAdmin,
      `/dashboard/programmes/${created.id}`,
    );
    await expect(
      programmeDetailUi.page.locator(`text=${created.reference}`).first(),
    ).toBeAttached({ timeout: 15_000 });
    await programmeDetailUi.context.close();
    await programmeDetailUi.api.dispose();

    // 10. Request detail renders with the linked programme
    const requestUi = await openAs(browser, accounts.requester, `/dashboard/requests/${requestId}`);
    await expect(requestUi.page).toHaveURL(/\/dashboard\/requests\//);
    await requestUi.context.close();
    await requestUi.api.dispose();

    await Promise.all([requester, tenantAdmin].map((api) => api.dispose()));
  });

  test('programme rejection path returns the draft for correction', async () => {
    const requester = await login(accounts.requester);
    const tenantAdmin = await login(accounts.tenantAdmin);

    const start = new Date(Date.now() + 45 * 86_400_000);
    const createResponse = await requester.post('/api/programmes', {
      data: {
        title: 'E2E Rejected Programme',
        purpose: 'To be rejected',
        startDate: start.toISOString(),
        endDate: new Date(start.getTime() + 3 * 86_400_000).toISOString(),
      },
    });
    expect(createResponse.status()).toBe(200);
    const created = (await createResponse.json()).data as { id: string; status: string };
    expect(created.status).toBe('draft');

    // Rejecting a draft is an invalid transition (only submit/archive allowed)
    const premature = await tenantAdmin.post(`/api/programmes/${created.id}/action`, {
      data: { action: 'reject' },
    });
    expect(premature.status()).toBe(409);

    await requester.post(`/api/programmes/${created.id}/action`, { data: { action: 'submit' } });

    // Reject requires a reason once the programme is submitted
    const noReason = await tenantAdmin.post(`/api/programmes/${created.id}/action`, {
      data: { action: 'reject' },
    });
    expect(noReason.status()).toBe(400);

    const reject = await tenantAdmin.post(`/api/programmes/${created.id}/action`, {
      data: { action: 'reject', note: 'Insufficient operational detail.' },
    });
    expect(reject.status(), await reject.text()).toBe(200);
    expect(((await reject.json()).data as { status: string }).status).toBe('rejected');

    // A rejected programme cannot be published
    const publish = await tenantAdmin.post(`/api/programmes/${created.id}/action`, {
      data: { action: 'publish' },
    });
    expect(publish.status()).toBe(409);

    const db = getDb();
    const [saved] = await db
      .select()
      .from(programmes)
      .where(eq(programmes.id, created.id))
      .limit(1);
    expect(saved.status).toBe('rejected');
    expect(saved.rejectionReason).toContain('Insufficient operational detail');

    await Promise.all([requester, tenantAdmin].map((api) => api.dispose()));
  });

  test('transport admins without programme permissions cannot create programmes', async () => {
    const transport = await login(accounts.transport);
    const response = await transport.post('/api/programmes', {
      data: { title: 'Should fail' },
    });
    // Transport Admin holds no programme:create permission → 403
    expect(response.status()).toBe(403);
    await transport.dispose();
  });
});
