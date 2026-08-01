import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const VIEWPORTS = [320, 375, 390, 430, 768, 1024, 1440] as const;

test('Tenant Branding keeps its existing tabs and uses the compact responsive layout', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/sign-in', {
    data: { email: 'admin@kavangoeast.gov.na', password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);

  const context = await browser.newContext({
    storageState: await api.storageState(),
    viewport: { width: VIEWPORTS[0], height: 900 },
  });
  const page = await context.newPage();
  await page.goto('/dashboard/settings', { waitUntil: 'domcontentloaded' });
  const brandingTab = page.getByRole('button', { name: 'Branding' });
  await brandingTab.click();
  await expect(brandingTab).toHaveClass(/bg-brand-800/);

  const topLayout = page.getByTestId('branding-top-layout');
  const preview = page.getByTestId('tenant-logo-preview');
  const columns = topLayout.locator(':scope > div');

  for (const width of VIEWPORTS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    await expect(topLayout).toBeVisible();

    const dimensions = await page.evaluate(() => ({
      content: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(dimensions.content, `${width}px horizontal overflow`).toBeLessThanOrEqual(
      dimensions.viewport + 2,
    );

    const previewBox = await preview.boundingBox();
    expect(previewBox).not.toBeNull();
    expect(previewBox!.width).toBeLessThanOrEqual(260);
    expect(previewBox!.height).toBe(176);

    const left = await columns.nth(0).boundingBox();
    const right = await columns.nth(1).boundingBox();
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    if (width >= 1024) {
      expect(right!.x).toBeGreaterThan(left!.x + left!.width - 2);
    } else {
      expect(Math.abs(right!.x - left!.x)).toBeLessThanOrEqual(2);
      expect(right!.y).toBeGreaterThan(left!.y);
    }
  }

  const primaryHex = page.getByLabel('Primary Colour', { exact: true });
  const primaryPicker = page.getByLabel('Choose primary colour');
  const accentHex = page.getByLabel('Accent Colour', { exact: true });
  const accentPicker = page.getByLabel('Choose accent colour');
  const originalPrimary = await primaryHex.inputValue();
  const originalAccent = await accentHex.inputValue();
  await primaryHex.fill('#123456');
  await expect(primaryPicker).toHaveValue('#123456');
  await primaryPicker.fill('#abcdef');
  await expect(primaryHex).toHaveValue('#ABCDEF');
  await accentHex.fill('#654321');
  await expect(accentPicker).toHaveValue('#654321');
  await accentPicker.fill('#fedcba');
  await expect(accentHex).toHaveValue('#FEDCBA');
  await primaryHex.fill(originalPrimary);
  await accentHex.fill(originalAccent);

  // Wait for the save API to complete before checking the toast
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes('/api/settings') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await responsePromise;
  // Toast auto-dismisses after 4s, so check quickly
  await expect(page.getByText('Settings saved')).toBeVisible({ timeout: 5_000 });
  // networkidle never fires here because the sidebar polls live counts;
  // wait for the content we actually need instead.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Branding' }).click();
  await expect(page.getByLabel('Primary Colour', { exact: true })).toHaveValue(originalPrimary);
  await expect(page.getByLabel('Accent Colour', { exact: true })).toHaveValue(originalAccent);

  await page.getByRole('button', { name: /select theme/i }).click();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(page.getByLabel('Choose tenant logo')).toHaveAttribute(
    'accept',
    'image/png,image/jpeg,image/webp',
  );
  const logoButton = page.getByRole('button', { name: /replace logo|upload logo/i });
  await expect(logoButton).toBeVisible();
  const fileChooserPromise = page.waitForEvent('filechooser');
  await logoButton.click();
  await fileChooserPromise;
  const logoImage = preview.locator('img');
  if (await logoImage.count()) {
    await expect
      .poll(() => logoImage.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  }

  await context.close();
  await api.dispose();
});
