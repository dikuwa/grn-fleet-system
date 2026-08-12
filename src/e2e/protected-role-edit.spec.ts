/**
 * Protected System-Role Editing — End-to-End Test
 *
 * Covers the protected system-role UX added for GRN FLEET:
 *   1. System role cards show System · Protected badges and a human-readable
 *      responsibility instead of the generic "GovFleet managed role." text.
 *   2. Clicking a system role opens READ-ONLY details first (no immediate
 *      permission checkboxes).
 *   3. "Edit protected role" opens the themed GRN FLEET confirmation dialog
 *      (NOT window.confirm) that requires typing EDIT ROLE.
 *   4. Required system permissions stay locked in the editor.
 *   5. Server-side enforcement: removing a required permission or renaming a
 *      built-in role is rejected (409); a user without role-management
 *      permission is denied (403).
 *   6. Custom tenant roles can be created with a responsibility description
 *      and edited normally.
 *   7. The Matrix view still renders.
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers (mirrors audit-trail-workflow.spec.ts)
// ---------------------------------------------------------------------------

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const TENANT_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';

async function signInAs(page: Page, email: string, password?: string) {
  const pw = password || process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password: pw },
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

  return { token, user: body.user || body.session?.user };
}

async function getCookieHeader(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'better-auth.session_token')?.value ?? '';
  return `better-auth.session_token=${token}`;
}

async function listRoles(page: Page) {
  const res = await page.request.get(`${BASE}/api/admin/roles`, {
    headers: { cookie: await getCookieHeader(page) },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  return body?.data?.roles || [];
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Protected system-role editing', () => {
  test.describe.configure({ mode: 'serial', timeout: 90000 });

  test.beforeEach(async ({ page }) => {
    await signInAs(page, TENANT_ADMIN_EMAIL);
  });

  test('1. system role cards communicate protection, responsibility and current access', async ({
    page,
  }) => {
    await page.goto('/dashboard/admin/roles', { waitUntil: 'domcontentloaded' });

    const card = page.locator('article').filter({ hasText: 'Transport Administrator' });
    await expect(card.first()).toBeVisible({ timeout: 30000 });

    // Badges: System + Protected (no generic "GovFleet managed role." text)
    const cardText = (await card.first().innerText()).toLowerCase();
    expect(cardText).toContain('system');
    expect(cardText).toContain('protected');
    expect(cardText).not.toContain('govfleet managed role');

    // Human-readable responsibility from role-metadata
    expect(cardText).toContain('reviews transport requests');

    // Current access + member/permission counts
    expect(cardText).toContain('current access');
    expect(cardText).toContain('active members');
    expect(cardText).toContain('permissions');
  });

  test('2. clicking a system role opens read-only details; editing needs typed EDIT ROLE confirmation', async ({
    page,
  }) => {
    await page.goto('/dashboard/admin/roles', { waitUntil: 'domcontentloaded' });

    const card = page.locator('article').filter({ hasText: 'Transport Administrator' }).first();
    await expect(card).toBeVisible({ timeout: 30000 });
    await card.click();

    // Read-only details dialog first — not the permission editor
    const detailsDialog = page.getByRole('dialog');
    await expect(detailsDialog).toBeVisible();
    await expect(detailsDialog.getByText('Responsibility', { exact: true })).toBeVisible();
    await expect(detailsDialog.getByRole('button', { name: /Edit protected role/ })).toBeVisible();

    // The details dialog is read-only: no permission checkboxes yet
    // (the app's Checkbox renders a button[role=checkbox], not a native input)
    await expect(detailsDialog.locator('[role="checkbox"]')).toHaveCount(0);

    // Open the protected-edit confirmation (themed dialog, not window.confirm)
    await detailsDialog.getByRole('button', { name: /Edit protected role/ }).click();

    // The unlock dialog renders last, so scope with .last() to avoid matching
    // the details dialog while it is still closing.
    const confirmDialog = page.getByRole('dialog').last();
    await expect(
      confirmDialog.getByText('Edit protected system role?', { exact: true }),
    ).toBeVisible();
    // The ConfirmDialog renders: Type "EDIT ROLE" to confirm: (quoted phrase
    // inside a <span>), so match loosely rather than on exact run-on text.
    await expect(confirmDialog.getByText(/EDIT ROLE.*to confirm/)).toBeVisible();

    const typedInput = confirmDialog.locator('input#confirm-dialog-value');
    const continueButton = confirmDialog.getByRole('button', { name: 'Continue' });

    // Continue disabled until the exact phrase is entered
    await expect(continueButton).toBeDisabled();
    await typedInput.fill('EDIT');
    await expect(continueButton).toBeDisabled();
    await typedInput.fill('EDIT ROLE');
    await expect(continueButton).toBeEnabled();
    await continueButton.click();

    // Editor opens with locked system-required permissions. The editor dialog
    // mounts while the unlock dialog is still closing, so scope with .last().
    const editor = page.getByRole('dialog').last();
    await expect(editor.getByText('Edit protected system role', { exact: true })).toBeVisible();
    await expect(editor.getByText('Required by system workflow').first()).toBeVisible();

    // The locked requirements are shown as disabled (locked) checkboxes
    const requiredItem = editor.getByText(/Required by system workflow/).first();
    await expect(requiredItem).toBeVisible();
    const lockedCheckboxes = editor.locator('button[role="checkbox"]:disabled');
    expect(await lockedCheckboxes.count()).toBeGreaterThan(0);

    // Built-in name input is disabled — identity cannot be edited from the UI
    await expect(editor.locator('input[value="Transport Administrator"]')).toBeDisabled();

    // Cancel resets the editing session — reopening the role asks again
    await editor.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('3. server rejects required-permission removal and system-role rename (409)', async ({
    page,
  }) => {
    const roles = await listRoles(page);
    const transport = roles.find(
      (r: { name: string; isSystem: boolean }) =>
        r.isSystem && r.name === 'Transport Administrator',
    );
    expect(transport).toBeTruthy();
    expect(transport.requiredPermissionCodes.length).toBeGreaterThan(0);

    const cookie = await getCookieHeader(page);

    // 3a. Dropping a required system permission → 409 with a readable message
    const required = transport.requiredPermissionCodes as string[];
    const resMissing = await page.request.patch(`${BASE}/api/admin/roles`, {
      data: {
        roleId: transport.id,
        name: transport.name,
        description: transport.description,
        permissionCodes: required.slice(0, required.length - 1),
      },
      headers: { cookie },
    });
    expect(resMissing.status()).toBe(409);
    const missingBody = await resMissing.json();
    expect(missingBody.error).toContain('Required system permissions cannot be removed');

    // 3b. Renaming a built-in role → 409
    const resRename = await page.request.patch(`${BASE}/api/admin/roles`, {
      data: {
        roleId: transport.id,
        name: 'Renamed Transport Administrator',
        description: transport.description,
        permissionCodes: required,
      },
      headers: { cookie },
    });
    expect(resRename.status()).toBe(409);
    const renameBody = await resRename.json();
    expect(renameBody.error).toContain('cannot be renamed');

    // 3c. The role still lists requiredPermissionCodes via GET
    const after = await listRoles(page);
    const stillThere = after.find((r: { name: string }) => r.name === 'Transport Administrator');
    expect(stillThere).toBeTruthy();
    expect(stillThere.requiredPermissionCodes.length).toBe(required.length);
  });

  test('4. custom roles support responsibility descriptions and normal editing', async ({
    page,
  }) => {
    const cookie = await getCookieHeader(page);
    const unique = `E2E Reviewer ${Date.now()}`;

    // Create a custom role with a responsibility description
    const createRes = await page.request.post(`${BASE}/api/admin/roles`, {
      data: {
        name: unique,
        description: 'Captures vehicle records and fuel transactions.',
        permissionCodes: [],
      },
      headers: { cookie },
    });
    expect(createRes.status()).toBe(201);

    const created = await listRoles(page);
    const custom = created.find((r: { name: string }) => r.name === unique);
    expect(custom).toBeTruthy();
    expect(custom.isSystem).toBe(false);
    expect(custom.description).toContain('Captures vehicle records');

    // The responsibility appears on the card (not a generic fallback)
    await page.goto('/dashboard/admin/roles', { waitUntil: 'domcontentloaded' });
    const customCard = page.locator('article').filter({ hasText: unique }).first();
    await expect(customCard).toBeVisible({ timeout: 30000 });
    await expect(customCard).toContainText('Captures vehicle records');
    await expect(customCard).toContainText('Custom');

    // Normal edit (no typed confirmation for custom roles)
    const editRes = await page.request.patch(`${BASE}/api/admin/roles`, {
      data: {
        roleId: custom.id,
        name: unique,
        description: 'Updated responsibility for E2E role.',
        permissionCodes: [],
      },
      headers: { cookie },
    });
    expect(editRes.status()).toBe(200);

    const edited = await listRoles(page);
    const updated = edited.find((r: { name: string }) => r.name === unique);
    expect(updated.description).toContain('Updated responsibility');
  });

  test('5. users without role-management permission are denied (403)', async ({ page }) => {
    // The seeded requester does not hold TENANT_MANAGE.
    await signInAs(page, process.env.SEED_REQUESTER_EMAIL || 'requester@kavangoeast.test');
    const res = await page.request.get(`${BASE}/api/admin/roles`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(res.status()).toBe(403);
  });

  test('6. matrix view still renders after the card rework', async ({ page }) => {
    await page.goto('/dashboard/admin/roles', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: /Matrix/ }).click();
    const table = page.locator('table');
    await expect(table).toBeVisible({ timeout: 15000 });
    await expect(table.getByText('Current access', { exact: true })).toBeVisible();
    await expect(table.getByRole('row').first()).toBeVisible();
  });
});
