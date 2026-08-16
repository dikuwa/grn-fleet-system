import { test, expect, Page } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function signIn(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  let res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password },
  });
  // Retry on rate limit (429) with backoff
  for (let attempt = 0; attempt < 5 && res.status() === 429; attempt++) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    res = await page.request.post(`${BASE}/api/auth/sign-in`, {
      data: { email, password },
    });
  }
  expect(res.status()).toBe(200);
  const body = await res.json();
  const token = body.token || body.session?.token;
  expect(token).toBeDefined();

  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      domain: new URL(BASE).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);

  return { token, user: body.user || body.session?.user };
}

async function getCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'better-auth.session_token')?.value ?? '';
  return `better-auth.session_token=${token}`;
}

test.describe('PDF Export', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('1. Reports page loads with export buttons', async ({ page }) => {
    await page.goto('/dashboard/reports');
    await expect(page.getByRole('heading', { name: 'Reports & Analytics' })).toBeVisible();

    // Should see export buttons
    const exportBtn = page
      .locator(
        'button:has-text("PDF"), button:has-text("Export"), a:has-text("PDF"), a:has-text("Export")',
      )
      .first();
    await expect(exportBtn).toBeVisible();
    const previewButton = page.getByRole('button', { name: 'Preview' });
    await expect(previewButton).toBeVisible();

    await previewButton.click();
    const previewDialog = page.getByRole('dialog');
    await expect(previewDialog).toBeVisible();
    const dialogBox = await previewDialog.boundingBox();
    const viewport = page.viewportSize();
    expect(dialogBox).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(dialogBox!.width).toBeGreaterThanOrEqual(viewport!.width * 0.9);
  });

  test('2. PDF export API returns a PDF for fleet report', async ({ page, request }) => {
    const cookieHeader = await getCookieHeader(page);

    const res = await request.get('/api/reports?type=fleet&period=30d&export=pdf', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.ok()).toBeTruthy();
    const contentType = res.headers()['content-type'] || '';
    expect(contentType).toContain('application/pdf');
    const body = await res.body();
    expect(body.length).toBeGreaterThan(100); // PDF should have content
    // PDF magic bytes: %PDF
    expect(Buffer.from(body.slice(0, 4)).toString()).toBe('%PDF');
  });

  test('3. PDF export API returns a PDF for fuel report', async ({ page, request }) => {
    const cookieHeader = await getCookieHeader(page);

    const res = await request.get('/api/reports?type=fuel&period=7d&export=pdf', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.ok()).toBeTruthy();
    const body = await res.body();
    expect(body.length).toBeGreaterThan(100);
    expect(Buffer.from(body.slice(0, 4)).toString()).toBe('%PDF');
  });

  test('4. PDF export API returns a PDF for trips report', async ({ page, request }) => {
    const cookieHeader = await getCookieHeader(page);

    const res = await request.get('/api/reports?type=trips&period=1y&export=pdf', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.ok()).toBeTruthy();
    const body = await res.body();
    expect(body.length).toBeGreaterThan(100);
    expect(Buffer.from(body.slice(0, 4)).toString()).toBe('%PDF');
  });

  test('5. PDF export API returns a PDF for maintenance report', async ({ page, request }) => {
    const cookieHeader = await getCookieHeader(page);

    const res = await request.get('/api/reports?type=maintenance&period=30d&export=pdf', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.ok()).toBeTruthy();
    const body = await res.body();
    expect(body.length).toBeGreaterThan(100);
    expect(Buffer.from(body.slice(0, 4)).toString()).toBe('%PDF');
  });

  test('6. PDF export API returns a PDF for transport requests report', async ({
    page,
    request,
  }) => {
    const cookieHeader = await getCookieHeader(page);

    const res = await request.get('/api/reports?type=requests&period=30d&export=pdf', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.ok()).toBeTruthy();
    const body = await res.body();
    expect(body.length).toBeGreaterThan(100);
    expect(Buffer.from(body.slice(0, 4)).toString()).toBe('%PDF');
  });

  test('7. PDF export API returns a PDF for approvals report', async ({ page, request }) => {
    const cookieHeader = await getCookieHeader(page);

    const res = await request.get('/api/reports?type=approvals&period=30d&export=pdf', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.ok()).toBeTruthy();
    const body = await res.body();
    expect(body.length).toBeGreaterThan(100);
    expect(Buffer.from(body.slice(0, 4)).toString()).toBe('%PDF');
  });

  test('8. PDF export returns 400 for invalid type', async ({ page, request }) => {
    const cookieHeader = await getCookieHeader(page);

    const res = await request.get('/api/reports?type=invalid&export=pdf', {
      headers: { Cookie: cookieHeader },
    });

    expect(res.status()).toBe(400);
  });

  test('9. PDF export returns 401 without auth', async ({ request }) => {
    const res = await request.get('/api/reports?type=fuel&period=30d&export=pdf');

    // Should either redirect or return 401
    expect(res.status() === 401 || res.status() === 307 || res.status() === 303).toBeTruthy();
  });
});
