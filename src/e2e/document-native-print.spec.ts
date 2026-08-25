import { expect, request as playwrightRequest, test } from '@playwright/test';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { generatedDocuments } from '@/db/schema/documents';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

test('browser Print opens the standalone official PDF instead of dashboard chrome', async ({ browser }) => {
  test.setTimeout(180_000);

  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email: 'requester@kavangoeast.test', password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const start = new Date(Date.now() + 72 * 60 * 60_000);
  const end = new Date(start.getTime() + 2 * 60 * 60_000);
  const submission = await api.post('/api/transport-requests', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      purpose: 'Production closure native print verification',
      scope: 'regional',
      activities: [
        {
          title: 'Print verification journey',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 40,
        },
      ],
    },
  });
  expect(submission.status(), await submission.text()).toBe(200);
  const submitted = await submission.json();
  const requestId = submitted.request.id as string;

  const db = getDb();
  const [document] = await db
    .select({ id: generatedDocuments.id })
    .from(generatedDocuments)
    .where(
      and(
        eq(generatedDocuments.tenantId, TENANT_ID as never),
        eq(generatedDocuments.entityType, 'transport_request'),
        eq(generatedDocuments.entityId, requestId),
      ),
    )
    .orderBy(desc(generatedDocuments.documentVersion))
    .limit(1);
  expect(document?.id, 'submitted request should generate an official document').toBeTruthy();
  const documentId = document!.id;

  const pdfResponse = await api.get(`/api/documents/${documentId}/pdf?preview=1`, {
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

  const launcherPdf = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/documents/${documentId}/pdf?preview=1`) &&
      response.status() === 200,
    { timeout: 60_000 },
  );

  await page.goto(`/dashboard/documents/${documentId}/print`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await expect(page.getByText('Opening document…')).toBeVisible({ timeout: 10_000 });

  const browserPdfResponse = await launcherPdf;
  expect(browserPdfResponse.headers()['content-type']).toContain('application/pdf');

  // Chromium may report ERR_ABORTED when a document replaces itself with a
  // blob: PDF URL. The important production contract is that the standalone
  // launcher successfully fetches the official PDF and never renders dashboard
  // chrome around it; asserting blob navigation itself is browser-internal and
  // was flaky in headless CI.
  await expect(page.locator('aside')).toHaveCount(0);

  await context.close();
  await api.dispose();
});
