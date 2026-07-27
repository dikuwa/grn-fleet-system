import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function sessionFor(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', {
    data: { email, password: PASSWORD },
  });
  expect(response.status(), `sign in ${email}`).toBe(200);
  return api;
}

test.describe('Live search and request people lookup', () => {
  test('requester searches active employees and authorised drivers by name', async () => {
    const api = await sessionFor('requester@kavangoeast.test');

    const employeeResponse = await api.get('/api/people-search?kind=employee&q=Maria');
    expect(employeeResponse.status()).toBe(200);
    const employeePayload = await employeeResponse.json();
    expect(employeePayload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fullName: 'Maria Shikongo', employeeNumber: 'KERC002' }),
      ]),
    );

    const driverResponse = await api.get('/api/people-search?kind=driver&q=Michael');
    expect(driverResponse.status()).toBe(200);
    const driverPayload = await driverResponse.json();
    expect(driverPayload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fullName: 'Michael Mwala',
          employeeNumber: 'KERC008',
          driverStatus: 'authorised',
        }),
      ]),
    );

    await api.dispose();
  });

  test('global search returns employee names as the administrator types', async ({ browser }) => {
    const api = await sessionFor('admin@kavangoeast.gov.na');
    const context = await browser.newContext({
      storageState: await api.storageState(),
      viewport: { width: 1280, height: 800 },
    });
    const page = await context.newPage();
    await page.goto('/dashboard', { waitUntil: 'networkidle' });
    await expect(page.getByRole('button', { name: /select theme/i }).first()).toBeVisible();

    const search = page.getByRole('searchbox', {
      name: /search requests, vehicles, and staff/i,
    });
    await search.fill('Maria');
    await expect(
      page.locator('button').filter({ hasText: 'Maria Shikongo' }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await context.close();
    await api.dispose();
  });
});
