/**
 * Platform Users — End-to-End Test
 *
 * Covers the platform-role protection and responsibility UX added to the
 * Platform Users page:
 *   1. Platform role rows show System · Protected badges instead of implying
 *      editable custom roles.
 *   2. Each row explains the role's responsibility in plain English.
 *   3. Each row shows a permission-derived "Current access" summary.
 *   4. The Add-platform-user dialog previews the selected role's
 *      responsibility and current access before creation.
 *
 * Uses the seeded platform super administrator account and runs serially so
 * the shared dev database is not raced by parallel writers.
 */
import { test, expect, Page } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const PLATFORM_ADMIN_EMAIL = process.env.PLATFORM_ADMIN_EMAIL || 'platform.admin@grnfleet.test';

async function signIn(page: Page) {
  const res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email: PLATFORM_ADMIN_EMAIL, password: PASSWORD },
  });
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
  return { user: body.user || body.session?.user };
}

test.describe('Platform Users role presentation', () => {
  test.describe.configure({ mode: 'serial', timeout: 60000 });

  test('platform rows communicate System · Protected roles with responsibility and current access', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`${BASE}/dashboard/platform/users`);
    await page.waitForLoadState('networkidle');

    // The platform administration note explains the protection model.
    await expect(page.getByText('Protected administrator continuity', { exact: true })).toBeVisible(
      { timeout: 20000 },
    );

    // Every platform user row carries a platform role with System + Protected badges.
    const rows = page.locator('article');
    await expect(rows.first()).toBeVisible({ timeout: 20000 });

    const firstRow = rows.first();
    await expect(firstRow.getByText('System', { exact: true })).toBeVisible();
    await expect(firstRow.getByText('Protected', { exact: true })).toBeVisible();

    // Each row shows a plain-English responsibility for the assigned role.
    await expect(
      firstRow.getByText(
        /owns platform operations|assists with platform onboarding|reviews platform activity/i,
      ),
    ).toBeVisible();

    // Each row shows the permission-derived current access summary.
    await expect(firstRow.getByText('Current access', { exact: true })).toBeVisible();
    const accessLine = firstRow.getByText('Current access').locator('..');
    await expect(accessLine).toContainText(/tenants|audit|support|platform/i);
  });

  test('the add-user dialog previews the selected role responsibility and current access', async ({
    page,
  }) => {
    await signIn(page);
    await page.goto(`${BASE}/dashboard/platform/users`);
    await page.waitForLoadState('networkidle');

    await page
      .getByRole('button', { name: /add platform user/i })
      .first()
      .click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 15000 });

    // The dialog explains that platform roles are protected system roles.
    await expect(dialog.getByText(/protected system roles?:/i)).toBeVisible();

    // The default role (Platform Support Administrator) previews its responsibility copy.
    await expect(dialog.getByText(/assists with platform onboarding/i)).toBeVisible();

    // The create dialog summarises the selected role's current access.
    await expect(dialog.getByText(/current access:/i)).toBeVisible();

    // The role selector is a Radix combobox; open it and verify the seeded options.
    await dialog.locator('#platform-user-role').click();
    await expect(page.getByRole('option', { name: 'Platform Super Administrator' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Platform Support Administrator' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Platform Auditor' })).toBeVisible();
  });
});
