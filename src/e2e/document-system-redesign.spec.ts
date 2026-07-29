import {
  expect,
  request as playwrightRequest,
  test,
  type Browser,
  type APIRequestContext,
  type Page,
} from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const SCREENSHOTS = 'docs/screenshots';

async function authenticatedContext(
  browser: Browser,
  email: string,
  viewport = { width: 1440, height: 1000 },
) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  let signIn = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  for (let attempt = 0; signIn.status() >= 500 && attempt < 2; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    signIn = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  }
  expect(signIn.status(), await signIn.text()).toBe(200);
  const context = await browser.newContext({ storageState: await api.storageState(), viewport });
  return { api, context };
}

async function firstDocument(page: Page, api: APIRequestContext, type: string) {
  let status = 'issued';
  await page.goto(`/dashboard/documents?type=${type}&status=${status}`, {
    waitUntil: 'domcontentloaded',
  });
  await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
  let link = page.locator('a[href^="/dashboard/documents/"]').first();
  if ((await link.count()) === 0) {
    status = 'draft';
    await page.goto(`/dashboard/documents?type=${type}&status=${status}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(page.getByRole('heading', { name: 'Documents', exact: true })).toBeVisible();
    link = page.locator('a[href^="/dashboard/documents/"]').first();
  }
  await expect(link, `seeded ${type} document`).toBeVisible();
  const href = await link.getAttribute('href');
  expect(href).toMatch(/^\/dashboard\/documents\/[0-9a-f-]+$/);
  if (status === 'draft') {
    const issue = await api.post(`/api/documents/${href!.split('/').pop()}/action`, {
      data: { action: 'issue' },
    });
    expect(issue.status(), await issue.text()).toBe(200);
  }
  return href!;
}

async function waitForVisibleImages(page: Page) {
  await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll('img')).every(
          (image) => image.complete && image.naturalWidth > 0,
        ),
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => {
      // Components provide a text fallback when an optional image cannot load.
    });
}

test.describe.serial('GovFleet document-system redesign', () => {
  test('renders real Transport Request and Trip Authority previews without JSON', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { api, context } = await authenticatedContext(browser, 'admin@kavangoeast.gov.na');
    const page = await context.newPage();

    const requestHref = await firstDocument(page, api, 'transport_request');
    await page.goto(requestHref, { waitUntil: 'domcontentloaded' });
    const requestPreview = page.getByTestId('human-readable-document');
    await expect(requestPreview).toBeVisible();
    await waitForVisibleImages(page);
    await expect(requestPreview).not.toContainText('[{');
    await expect(requestPreview).not.toContainText('{"');
    await page.screenshot({
      path: `${SCREENSHOTS}/document-transport-request-redesign.png`,
      fullPage: true,
    });

    const requestId = requestHref.split('/').pop()!;
    const pdf = await api.get(`/api/documents/${requestId}/pdf`);
    expect(pdf.status(), await pdf.text()).toBe(200);
    expect(pdf.headers()['content-type']).toContain('application/pdf');
    expect(Buffer.from((await pdf.body()).subarray(0, 4)).toString()).toBe('%PDF');

    const authorityHref = await firstDocument(page, api, 'trip_authority');
    await page.goto(authorityHref, { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('human-readable-document')).toBeVisible();
    await waitForVisibleImages(page);
    await page.screenshot({
      path: `${SCREENSHOTS}/document-trip-authority-redesign.png`,
      fullPage: true,
    });

    const mobile = await browser.newContext({
      storageState: await api.storageState(),
      viewport: { width: 390, height: 844 },
    });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(requestHref, { waitUntil: 'domcontentloaded' });
    await expect(mobilePage.getByTestId('human-readable-document')).toBeVisible();
    expect(
      await mobilePage.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
    await mobilePage.screenshot({
      path: `${SCREENSHOTS}/document-mobile-preview.png`,
      fullPage: true,
    });

    await mobile.close();
    await context.close();
    await api.dispose();
  });

  test('bulk-selects employees and captures external traveller details', async ({ browser }) => {
    test.setTimeout(120_000);
    const { api, context } = await authenticatedContext(browser, 'requester@kavangoeast.test', {
      width: 1280,
      height: 900,
    });
    const page = await context.newPage();
    await page.goto('/dashboard/requests/new', { waitUntil: 'domcontentloaded' });
    const purpose = page.locator('textarea[placeholder^="Describe the purpose"]');
    await expect(purpose).toBeVisible({ timeout: 20_000 });
    const purposeHandle = await purpose.elementHandle();
    await page.waitForFunction(
      (element) =>
        Object.keys(element as unknown as Record<string, unknown>).some((key) =>
          key.startsWith('__reactProps$'),
        ),
      purposeHandle,
      { timeout: 20_000 },
    );
    await purpose.click();
    await purpose.pressSequentially('Document redesign validation trip');
    const continueButton = page.getByRole('button', { name: /Continue/i });
    await expect(continueButton).toBeEnabled({ timeout: 20_000 });
    await continueButton.click();
    await page.getByRole('button', { name: /Continue/i }).click();

    await page.locator('button[role="combobox"]').first().click();
    const search = page.getByPlaceholder(/Name, employee number, department, office/i);
    await search.fill('Maria');
    await page.getByRole('option', { name: /Maria Shikongo/i }).click();
    await search.fill('Petrus');
    await page.getByRole('option', { name: /Petrus Ndara/i }).click();
    await expect(page.getByText('2 employees selected').first()).toBeVisible();

    await page.getByRole('button', { name: /Add external traveller/i }).click();
    await page.getByLabel('Full name *').fill('Selma External Traveller');
    await page.getByLabel('Organisation').fill('Ministry of Works and Transport');
    await page.getByLabel('Role on trip').fill('Technical observer');
    await page.getByLabel('Reason for travelling').fill('Project inspection');

    await page.screenshot({
      path: `${SCREENSHOTS}/document-employee-multi-select.png`,
      fullPage: true,
    });

    await context.close();
    await api.dispose();
  });

  test('creates, opens, shares and revokes a short secure verification link', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { api, context } = await authenticatedContext(browser, 'admin@kavangoeast.gov.na');
    const page = await context.newPage();
    const documentHref = await firstDocument(page, api, 'transport_request');
    const documentId = documentHref.split('/').pop()!;

    const create = await api.post('/api/share-links', {
      data: {
        documentId,
        expiresInHours: 1,
        allowDownload: true,
        createSeparateLink: true,
      },
    });
    expect(create.status(), await create.text()).toBe(200);
    const created = (await create.json()).data;
    expect(created.shareUrl).toMatch(/\/v\/[A-Z0-9-]+$/);
    expect(created.shareUrl).not.toContain(documentId);
    const localVerificationUrl = `${BASE}${new URL(created.shareUrl).pathname}`;

    const publicContext = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const verifier = await publicContext.newPage();
    await verifier.goto(localVerificationUrl, { waitUntil: 'domcontentloaded' });
    await expect(verifier.getByText('Verified and active')).toBeVisible();
    await expect(verifier.getByText('GovFleet secure document verification')).toBeVisible();
    await expect(verifier.locator('header p').first()).toContainText(
      'Kavango East Regional Council',
    );
    await waitForVisibleImages(verifier);
    await expect(verifier.getByText(documentId)).toHaveCount(0);
    await verifier.screenshot({
      path: `${SCREENSHOTS}/document-verification-page.png`,
      fullPage: true,
    });

    await page.goto(documentHref, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /^Share$/ }).click();
    await expect(page.getByRole('heading', { name: 'Share verified document' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Open in WhatsApp/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Copy secure link/i })).toBeVisible();
    await page.screenshot({
      path: `${SCREENSHOTS}/document-share-dialog.png`,
      fullPage: true,
    });

    const revoke = await api.delete(`/api/share-links?linkId=${created.id}`);
    expect(revoke.status(), await revoke.text()).toBe(200);
    await verifier.reload({ waitUntil: 'domcontentloaded' });
    await expect(verifier.getByRole('heading', { name: 'Link revoked' })).toBeVisible();

    await publicContext.close();
    await context.close();
    await api.dispose();
  });

  test('presents audit events as readable sentences with controlled technical details', async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const { api, context } = await authenticatedContext(browser, 'admin@kavangoeast.gov.na');
    const page = await context.newPage();
    await page.goto('/dashboard/audit', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Audit Log' })).toBeVisible();
    await expect(page.getByText(/Technical details/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('pre')).toHaveCount(0);
    await page.screenshot({
      path: `${SCREENSHOTS}/document-audit-human-readable.png`,
      fullPage: true,
    });

    await context.close();
    await api.dispose();
  });
});
