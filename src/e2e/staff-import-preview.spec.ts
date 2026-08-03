import { test, expect, Page } from '@playwright/test';

/**
 * Helper: Sign in via API and inject the session cookie so the test browser
 * is authenticated for protected dashboard routes.
 */
async function signInAndSetCookie(
  page: Page,
  email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na',
) {
  const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  let res = await page.request.post(`${baseURL}/api/auth/sign-in`, {
    data: { email, password },
  });
  // Retry on rate limit (429) with backoff
  for (let attempt = 0; attempt < 5 && res.status() === 429; attempt++) {
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    res = await page.request.post(`${baseURL}/api/auth/sign-in`, {
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
      domain: new URL(baseURL).hostname,
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);
}

/**
 * Builds a small staff CSV with:
 *  - one fully valid row (active, driver = yes)
 *  - one row missing the required last name (row-level error)
 *  - one row reusing an employee number from the first row (duplicate error)
 */
function buildStaffCsv(): Buffer {
  // Department/office are optional and deliberately left blank: the E2E tenant
  // may not contain an exact entity name, and an unresolved entity mapping
  // would disable the Continue button before the preview is ever reached.
  const header =
    'employee_number,title,first_name,middle_names,last_name,gender,job_title,job_grade,department,office,email,phone,employment_status,is_driver';
  const rows = [
    'KE9001,,Ada,,Lovelace,F,Driver,3,,,,ada.import@kavangoeast.test,0810000001,active,yes',
    'KE9002,,Grace,,,F,Driver,3,,,,,0810000002,active,no',
    'KE9001,,Alan,,Turing,M,Driver,3,,,,,0810000003,active,no',
  ];
  return Buffer.from([header, ...rows].join('\n'), 'utf-8');
}

test.describe('Staff Import — Defaults Card, Row-Level Errors & Error File', () => {
  test.setTimeout(60_000);

  test.beforeEach(async ({ page }) => {
    await signInAndSetCookie(page);
  });

  test('preview shows defaults card, summary counts and expandable row errors', async ({ page }) => {
    await page.goto('/dashboard/staff/import', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Import Staff")').first()).toBeVisible({ timeout: 20000 });

    // Upload the CSV through the hidden file input
    await page.setInputFiles('input[type="file"]', {
      name: 'staff-errors.csv',
      mimeType: 'text/csv',
      buffer: buildStaffCsv(),
    });

    // Auto-mapped columns land us on the Column Mapping step; continue to preview.
    await expect(page.locator('text=Column Mapping').first()).toBeVisible({ timeout: 15000 });
    const continueBtn = page.locator('button:has-text("Continue to Preview")').first();
    await expect(continueBtn).toBeEnabled({ timeout: 15000 });
    await continueBtn.click();

    // Defaults card: the four canonical defaults are shown.
    await expect(page.locator('text=Defaults Applied to Every Imported Row').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Employment status').first()).toBeVisible();
    await expect(page.locator('text=Availability').first()).toBeVisible();
    await expect(page.locator('text=Login account').first()).toBeVisible();
    await expect(page.locator('text=Driver profile').first()).toBeVisible();

    // Summary counts: 3 total, 1 valid, 2 with errors.
    await expect(page.locator('text=Total Rows').first()).toBeVisible();
    await expect(page.locator('text=Valid').first()).toBeVisible();
    await expect(page.locator('text=Errors').first()).toBeVisible();

    // Validation Errors panel + Download Error File button appear because rows failed.
    await expect(page.locator('text=Validation Errors').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('button:has-text("Download Error File")').first()).toBeVisible();

    // With any invalid rows the bulk import button must NOT be offered.
    await expect(page.locator('button:has-text("Import Valid Record")').first()).toHaveCount(0);

    // Expand the row-level errors for the row missing a surname.
    const brokenRow = page.locator('tr', { hasText: 'Grace' }).first();
    await expect(brokenRow).toBeVisible({ timeout: 10000 });
    await brokenRow.click();
    await expect(page.locator('text=Missing required field: Last Name').first()).toBeVisible({ timeout: 10000 });
  });

  test('download error file contains the failing rows with reasons', async ({ page }) => {
    await page.goto('/dashboard/staff/import', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Import Staff")').first()).toBeVisible({ timeout: 20000 });

    await page.setInputFiles('input[type="file"]', {
      name: 'staff-errors.csv',
      mimeType: 'text/csv',
      buffer: buildStaffCsv(),
    });

    await expect(page.locator('text=Column Mapping').first()).toBeVisible({ timeout: 15000 });
    await page.locator('button:has-text("Continue to Preview")').first().click();

    await expect(page.locator('button:has-text("Download Error File")').first()).toBeVisible({ timeout: 15000 });

    const downloadPromise = page.waitForEvent('download');
    await page.locator('button:has-text("Download Error File")').first().click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toContain('govfleet-import-errors');

    // Read the downloaded CSV back and verify both failing rows are listed.
    const downloadPath = await download.path();
    const fs = await import('node:fs');
    const content = fs.readFileSync(downloadPath, 'utf-8');

    expect(content).toContain('Row Number,Employee Number,Name,Validation Errors');
    expect(content).toContain('Missing required field: Last Name');
    expect(content).toContain('Duplicate employee number in this file.');
  });
});
