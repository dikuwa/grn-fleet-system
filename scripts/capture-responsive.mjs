import { chromium, request } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const baseURL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const outputDir =
  process.env.RESPONSIVE_SCREENSHOT_DIR || path.resolve('artifacts/responsive-screenshots');
const email = process.env.RESPONSIVE_SCREENSHOT_EMAIL || 'admin@kavangoeast.gov.na';
const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';
const viewports = [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
];

await mkdir(outputDir, { recursive: true });
const api = await request.newContext({ baseURL });
const response = await api.post('/api/auth/sign-in', { data: { email, password } });
if (!response.ok()) throw new Error(`Screenshot login failed (${response.status()})`);
const storageState = await api.storageState();
const browser = await chromium.launch();

for (const viewport of viewports) {
  const context = await browser.newContext({ storageState, viewport });
  const page = await context.newPage();
  await page.addInitScript(
    (theme) => localStorage.setItem('govfleet-theme', theme),
    viewport.width === 390 ? 'dark' : 'light',
  );
  await page.goto(`${baseURL}/dashboard/admin/users`, { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    page: document.documentElement.scrollWidth,
  }));
  if (dimensions.page > dimensions.viewport + 1) {
    throw new Error(`Page overflow at ${viewport.width}px: ${dimensions.page}px`);
  }
  await page.screenshot({
    path: path.join(outputDir, `admin-users-${viewport.width}px.png`),
    fullPage: true,
  });
  await context.close();
}

await browser.close();
await api.dispose();
console.log(`Captured ${viewports.length} responsive screenshots in ${outputDir}`);
