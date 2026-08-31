import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', {
    data: { email, password: PASSWORD },
  });
  expect(response.status(), `login ${email}`).toBe(200);
  return api;
}

async function createApprovedProgramme(
  requester: APIRequestContext,
  tenantAdmin: APIRequestContext,
  title: string,
) {
  const start = new Date(Date.now() + 60 * 86_400_000);
  const end = new Date(start.getTime() + 2 * 86_400_000);

  const create = await requester.post('/api/programmes', {
    data: {
      title,
      purpose: 'Release-readiness programme selector scale guard',
      department: 'Transport',
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      venue: 'Release readiness fixture',
    },
  });
  expect(create.status(), await create.text()).toBe(200);
  const programme = (await create.json()).data as {
    id: string;
    reference: string;
    title: string;
  };

  const submit = await requester.post(`/api/programmes/${programme.id}/action`, {
    data: { action: 'submit' },
  });
  expect(submit.status(), await submit.text()).toBe(200);

  const approve = await tenantAdmin.post(`/api/programmes/${programme.id}/action`, {
    data: { action: 'approve', note: 'Approved for selector scale verification' },
  });
  expect(approve.status(), await approve.text()).toBe(200);

  return programme;
}

test('programme beyond the initial 20-result window remains searchable and selectable', async ({
  browser,
}) => {
  test.setTimeout(300_000);

  const requester = await login('requester@kavangoeast.test');
  const tenantAdmin = await login('admin@kavangoeast.gov.na');
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const targetTitle = `Selector scale target ${suffix}`;

  const target = await createApprovedProgramme(requester, tenantAdmin, targetTitle);

  // Create 20 newer eligible programmes so the target is guaranteed to sit
  // outside the selector's initial 20-row window when results are ordered by
  // newest creation first.
  for (let index = 0; index < 20; index += 1) {
    await createApprovedProgramme(
      requester,
      tenantAdmin,
      `Selector scale filler ${suffix}-${String(index + 1).padStart(2, '0')}`,
    );
  }

  const initial = await requester.get('/api/programmes?selectable=1&limit=20');
  expect(initial.status(), await initial.text()).toBe(200);
  const initialRows = ((await initial.json()).data || []) as Array<{ id: string }>;
  expect(initialRows).toHaveLength(20);
  expect(initialRows.some((row) => row.id === target.id)).toBe(false);

  const context = await browser.newContext({ storageState: await requester.storageState() });
  const page = await context.newPage();
  await page.goto('/dashboard/requests/new', { waitUntil: 'domcontentloaded' });

  const programmeTrigger = page.getByRole('combobox', {
    name: 'Search approved programmes',
  });
  await expect(programmeTrigger).toBeVisible({ timeout: 15_000 });
  await programmeTrigger.click();

  const search = page.getByPlaceholder(
    'Search by programme, reference, department or venue…',
  );
  await expect(search).toBeVisible();
  await search.fill(targetTitle);

  const targetOption = page.getByRole('option').filter({ hasText: targetTitle });
  await expect(targetOption).toBeVisible({ timeout: 15_000 });
  await targetOption.click();

  await expect(programmeTrigger).toContainText(target.reference);
  await expect(programmeTrigger).toContainText(targetTitle);

  await context.close();
  await Promise.all([requester.dispose(), tenantAdmin.dispose()]);
});
