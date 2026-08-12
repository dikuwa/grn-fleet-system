/**
 * Browser-review capture — visual verification of the protected-role flow and
 * the themed Operational Data Reset date picker. Run against a live server on
 * port 3000 (production build + seed). Outputs PNGs to artifacts/browser-review.
 */
import { chromium, request } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const outputDir = path.resolve('artifacts/browser-review');
const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

await mkdir(outputDir, { recursive: true });

const api = await request.newContext({ baseURL });
const signIn = await api.post('/api/auth/sign-in', { data: { email, password } });
if (!signIn.ok()) throw new Error(`Login failed (${signIn.status()})`);
const storageState = await api.storageState();
await api.dispose();

const browser = await chromium.launch();
const context = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const shot = (name) =>
  page.screenshot({ path: path.join(outputDir, `${name}.png`), fullPage: false });

// ── Roles & Permissions ─────────────────────────────────────────────────────
await page.goto(`${baseURL}/dashboard/admin/roles`, { waitUntil: 'load' });
await page.locator('article').filter({ hasText: 'Transport Administrator' }).first().waitFor();
await page.waitForTimeout(600);
await shot('roles-cards');

const card = page.locator('article').filter({ hasText: 'Transport Administrator' }).first();
await card.click();
await page.getByRole('dialog').waitFor();
await page.waitForTimeout(500);
await shot('roles-details-readonly');

await page.getByRole('dialog').getByRole('button', { name: /Edit protected role/ }).click();
await page.getByRole('dialog').last().waitFor();
await page.waitForTimeout(500);
await shot('roles-unlock-dialog');

const confirmDialog = page.getByRole('dialog').last();
const typedInput = confirmDialog.locator('input#confirm-dialog-value');
await typedInput.fill('EDIT ROLE');
await page.getByRole('dialog').last().getByRole('button', { name: 'Continue' }).click();
await page.getByRole('dialog').last().waitFor();
await page.waitForTimeout(500);
await shot('roles-editor-locked');

// Matrix view
await page.getByRole('dialog').last().getByRole('button', { name: 'Cancel' }).click();
await page.getByRole('button', { name: /Matrix/ }).click();
await page.locator('table').waitFor();
await page.waitForTimeout(400);
await shot('roles-matrix');  // ── Operational Data Reset date picker ─────────────────────────────────────
  await page.goto(`${baseURL}/dashboard/admin/data-reset`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await shot('reset-page');

  // The Historical Cutoff field now renders the themed DatePicker (a button
  // with aria-label "Select date"); the calendar is the GRN FLEET Calendar.
  const cutoffTrigger = page
    .locator('button[aria-label="Select date"]')
    .or(page.locator('button[aria-label*="select date" i]'))
    .first();
  if ((await cutoffTrigger.count()) > 0) {
    await cutoffTrigger.click();
    await page.waitForTimeout(700);
    await shot('reset-datepicker-open');
    // Show the populated date so Clear is visible too.
    const day = page.locator('.rdp-day').filter({ hasText: /^1[05]$/ }).first();
    if ((await day.count()) > 0) {
      await day.click();
      await page.waitForTimeout(400);
      await shot('reset-datepicker-cleared');
    }
  }

await browser.close();
console.log(`Captured browser-review screenshots in ${outputDir}`);
