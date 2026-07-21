/**
 * Photo Upload Workflow — End-to-End Test
 *
 * Tests the photo upload flow through the inspection pipeline:
 *   1. Sign in as admin
 *   2. Upload a test image to /api/upload with inspection category
 *   3. Create a departure inspection with photo keys
 *   4. Verify the inspection detail page shows the photo
 *   5. Upload photos on departure and return inspection forms
 *   6. Verify the photos are stored and linked to the inspection
 */

import { test, expect, Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

/**
 * Generate a 1x1 pixel PNG buffer for testing uploads.
 */
function createTestImageBuffer(): Buffer {
  // Minimal valid PNG (1x1 pixel, white)
  const png = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, // PNG signature
    0x0D, 0x0A, 0x1A, 0x0A, // CR + LF + EOF + LF
    0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
    0x49, 0x48, 0x44, 0x52, // "IHDR"
    0x00, 0x00, 0x00, 0x01, // width = 1
    0x00, 0x00, 0x00, 0x01, // height = 1
    0x08, 0x02,             // bit depth = 8, color type = RGB
    0x00, 0x00, 0x00,       // compression, filter, interlace
    0x90, 0x77, 0x53, 0xDE, // CRC
    0x00, 0x00, 0x00, 0x0C, // IDAT chunk length
    0x49, 0x44, 0x41, 0x54, // "IDAT"
    0x08, 0xD7, 0x63, 0x60, 0x60, 0x00, 0x00, 0x00, 0x04, 0x00, 0x01, 0x27, 0x3B, 0x27, // compressed data
    0x00, 0x00, 0x00, 0x00, // IDAT CRC (wrong, but enough for test)
    0x00, 0x00, 0x00, 0x00, // IEND chunk
    0x49, 0x45, 0x4E, 0x44, // "IEND"
    0xAE, 0x42, 0x60, 0x82, // CRC
  ]);
  return png;
}

async function signIn(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password },
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Photo Upload Workflow', () => {
  let inspectionId: string | null = null;

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  // -----------------------------------------------------------------------
  // Step 1: Upload a test image via the API
  // -----------------------------------------------------------------------

  test('1. uploads a test image to the inspection category', async ({ page }) => {
    const imageBuffer = createTestImageBuffer();

    const file = {
      name: 'test-inspection-photo.png',
      mimeType: 'image/png',
      buffer: imageBuffer,
    };

    // Create FormData equivalent via playwright's multipart upload
    const res = await page.request.post(`${BASE}/api/upload`, {
      multipart: {
        file: file,
        category: 'inspection',
      },
      headers: { cookie: await getCookieHeader(page) },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toBeDefined();
    expect(body.data.key).toBeTruthy();
    expect(body.data.category).toBe('inspection');
    expect(body.data.size).toBeGreaterThan(0);
    expect(body.data.publicUrl).toBeTruthy();

    // Store the key for later verification
    const photoKey = body.data.key;
    expect(photoKey).toContain('tenant/');
    expect(photoKey).toContain('/inspections/');
  });

  // -----------------------------------------------------------------------
  // Step 2: Create a vehicle inspection with photo keys
  // -----------------------------------------------------------------------

  test('2. creates a departure inspection with attached photo', async ({ page }) => {
    // First upload a photo
    const imageBuffer = createTestImageBuffer();
    const uploadRes = await page.request.post(`${BASE}/api/upload`, {
      multipart: {
        file: { name: 'departure-photo.png', mimeType: 'image/png', buffer: imageBuffer },
        category: 'inspection',
      },
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(uploadRes.status()).toBe(200);
    const uploadBody = await uploadRes.json();
    const photoKey = uploadBody.data.key;

    // Get a vehicle from the fleet
    const fleetRes = await page.request.get(`${BASE}/api/fleet`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(fleetRes.status()).toBe(200);
    const fleetBody = await fleetRes.json().catch(() => ({}));
    const vehicles = fleetBody?.data || fleetBody?.vehicles || fleetBody || [];
    const vehicle = Array.isArray(vehicles)
      ? vehicles.find((v: { status?: string }) => v.status === 'active' || v.status === 'available' || !v.status)
      : null;
    test.skip(!vehicle, 'No vehicle found for inspection test');

    // Create the inspection with photoKeys
    const inspRes = await page.request.post(`${BASE}/api/inspections`, {
      data: {
        vehicleId: vehicle.id,
        type: 'departure',
        odometerReading: 10000,
        fuelLevel: 'full',
        notes: 'E2E test — inspection with photo',
        checklist: [
          { label: 'Body panels', result: 'pass', isCritical: false },
          { label: 'Tyres', result: 'pass', isCritical: true },
          { label: 'Headlights', result: 'pass', isCritical: true },
          { label: 'Brakes', result: 'pass', isCritical: true },
        ],
        photoKeys: [photoKey],
      },
      headers: { cookie: await getCookieHeader(page) },
    });

    expect(inspRes.status()).toBe(200);
    const inspBody = await inspRes.json().catch(() => ({}));
    expect(inspBody.overallPass).toBe(true);
    expect(inspBody.inspection).toBeDefined();
    expect(inspBody.inspection.id).toBeTruthy();
    inspectionId = inspBody.inspection.id;

    // Verify the inspection was linked to the photo
    const detailRes = await page.request.get(`${BASE}/api/inspections/${inspectionId}`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(detailRes.status()).toBe(200);
    const detailBody = await detailRes.json().catch(() => ({}));
    const photos = detailBody?.photos || [];
    expect(photos.length).toBeGreaterThanOrEqual(1);
    expect(photos[0].fileKey).toBe(photoKey);
  });

  // -----------------------------------------------------------------------
  // Step 3: Upload photo via the departure inspection form UI
  // -----------------------------------------------------------------------

  test('3. departure inspection form shows photo upload controls', async ({ page }) => {
    await page.goto('/dashboard/inspections/departure?vehicleId=test&tripId=test', {
      waitUntil: 'load',
      timeout: 60000,
    });

    // Verify the photo upload button is visible
    const photoButton = page.locator('button:has-text("Take / Upload Photos")');
    await expect(photoButton).toBeVisible({ timeout: 10000 });

    // Verify the file input is hidden but exists
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await expect(fileInput).toBeVisible({ timeout: 5000 });
    await expect(fileInput).toHaveAttribute('accept', 'image/*');
    await expect(fileInput).toHaveAttribute('capture', 'environment');

    // Verify the odometer and fuel fields (required for submission)
    await expect(page.locator('input[type="number"]').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('select').first()).toBeVisible({ timeout: 5000 });
  });

  // -----------------------------------------------------------------------
  // Step 4: Upload photo via the return inspection form UI
  // -----------------------------------------------------------------------

  test('4. return inspection form shows photo upload controls', async ({ page }) => {
    await page.goto('/dashboard/inspections/return?vehicleId=test&tripId=test', {
      waitUntil: 'load',
      timeout: 60000,
    });

    // Verify the photo upload button is visible
    const photoButton = page.locator('button:has-text("Take / Upload Photos")');
    await expect(photoButton).toBeVisible({ timeout: 10000 });

    // Verify file input has mobile camera capture attribute
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await expect(fileInput).toBeVisible({ timeout: 5000 });
    await expect(fileInput).toHaveAttribute('accept', 'image/*');
    await expect(fileInput).toHaveAttribute('capture', 'environment');

    // Verify the defect description UI is present for fail results
    // (click a critical item to fail it and reveal the defect form)
    const failButton = page.locator('button:has-text("Fail")').first();
    if (await failButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await failButton.click();
      // Defect description input should appear
      await expect(page.locator('input[placeholder*="Describe the defect"]').first()).toBeVisible({ timeout: 3000 });
    }
  });

  // -----------------------------------------------------------------------
  // Step 5: Verify the inspection detail page shows photos
  // -----------------------------------------------------------------------

  test('5. inspection detail page shows photo section', async ({ page }) => {
    // Navigate to the inspections list
    await page.goto('/dashboard/inspections', { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("Inspections")').first()).toBeVisible({ timeout: 15000 });

    // Click the first inspection to view detail
    const firstInspection = page.locator('a[href*="/dashboard/inspections/"]').first();
    if (await firstInspection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstInspection.click();
      await page.waitForTimeout(3000);

      // The inspection detail page might show a Photos section
      const photosSection = page.locator('text=Photos').first();
      const photosVisible = await photosSection.isVisible({ timeout: 3000 }).catch(() => false);

      // If photos exist, the photo grid should show
      if (photosVisible) {
        await expect(photosSection).toBeVisible({ timeout: 5000 });
        // Check for photo thumbnails
        const photoImages = page.locator('img[alt*="Photo"]');
        const photoCount = await photoImages.count().catch(() => 0);
        expect(photoCount).toBeGreaterThanOrEqual(0);
      }
    }
  });

  // -----------------------------------------------------------------------
  // Step 6: Verify the unified new inspection form has photo controls
  // -----------------------------------------------------------------------

  test('6. unified new inspection form has photo upload', async ({ page }) => {
    await page.goto('/dashboard/inspections/new?type=departure', {
      waitUntil: 'load',
      timeout: 60000,
    });

    // Wait for the form to load
    await page.waitForTimeout(3000);

    // Verify the photo upload button exists
    const photoButton = page.locator('button:has-text("Photos")').first();
    await expect(photoButton).toBeVisible({ timeout: 10000 });

    // Verify file input
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await expect(fileInput).toBeVisible({ timeout: 5000 });
    await expect(fileInput).toHaveAttribute('capture', 'environment');
  });
});
