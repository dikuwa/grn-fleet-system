import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const accounts = [
  ['tenant-admin', 'admin@kavangoeast.gov.na', 'KERC001', 'Tenant Administrator'],
  ['platform-admin', 'platform.admin@grnfleet.test', 'KERC014', 'Platform Super Administrator'],
  ['transport-admin', 'transport.admin@kavangoeast.test', 'KERC011', 'Transport Administrator'],
  ['requester', 'requester@kavangoeast.test', 'KERC002', 'Requester / Programme Owner'],
  ['supervisor', 'supervisor@kavangoeast.test', 'KERC003', 'Immediate Supervisor'],
  [
    'release-officer',
    'release.officer@kavangoeast.test',
    'KERC004',
    'Control Administrative Officer',
  ],
  ['regional-authoriser', 'regional.authoriser@kavangoeast.test', 'KERC005', 'Deputy Director'],
  ['national-release', 'national.release@kavangoeast.test', 'KERC006', 'Director'],
  [
    'national-authoriser',
    'national.authoriser@kavangoeast.test',
    'KERC007',
    'Chief Regional Officer',
  ],
  ['driver', 'driver@kavangoeast.test', 'KERC008', 'Assigned Driver'],
  ['inspector', 'inspector@kavangoeast.test', 'KERC012', 'Inspector'],
  ['maintenance', 'maintenance@kavangoeast.test', 'KERC013', 'Maintenance Officer'],
  ['auditor', 'auditor@kavangoeast.test', 'KERC010', 'Tenant Auditor'],
] as const;

test.describe('seeded login identity isolation', () => {
  test.setTimeout(300_000);

  test('username and email resolve to the same isolated profile for every role', async () => {
    for (const [username, email, employeeNumber, role] of accounts) {
      let expectedUserId: string | null = null;

      for (const identifier of [username, email]) {
        const api = await playwrightRequest.newContext({ baseURL: BASE });
        const signIn = await api.post('/api/auth/custom-sign-in', {
          data: { username: identifier, password: PASSWORD },
        });
        expect(signIn.status(), `${identifier} login: ${await signIn.text()}`).toBe(200);

        const profileResponse = await api.get('/api/users/profile');
        expect(profileResponse.status(), `${identifier} profile`).toBe(200);
        const profile = (await profileResponse.json()).data;

        expect(profile.email).toBe(email);
        expect(profile.employee?.employeeNumber).toBe(employeeNumber);
        expect(profile.roles.map((item: { roleName: string }) => item.roleName)).toEqual([role]);
        if (expectedUserId) expect(profile.id).toBe(expectedUserId);
        expectedUserId = profile.id;

        await api.dispose();
      }
    }
  });

  test('switching from driver to requester clears cached identity and navigation', async ({
    page,
  }) => {
    const signIn = async (identifier: string) => {
      await page.goto('/login');
      await page.getByPlaceholder('Enter your username or email').fill(identifier);
      await page.getByPlaceholder('Enter your password').fill(PASSWORD);
      await page.getByRole('button', { name: 'Sign In' }).click();
      await page.waitForURL(/\/dashboard(?:\/|$)/, { timeout: 60_000 });
    };

    await signIn('driver');
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await expect(page.getByText('Michael Mwala').first()).toBeVisible();
    await expect(page.locator('a[href="/dashboard/driver-mobile"]').first()).toBeVisible();
    await page.getByRole('menuitem', { name: /sign out/i }).click();
    await page.waitForURL(/\/login/, { timeout: 30_000 });

    await signIn('requester@kavangoeast.test');
    await page.getByRole('button', { name: 'Open account menu' }).click();
    await expect(page.getByText('Maria Shikongo').first()).toBeVisible();
    await expect(page.locator('a[href="/dashboard/driver-mobile"]')).toHaveCount(0);
    await expect(page.locator('a[href="/dashboard/requests"]').first()).toBeVisible();
  });
});
