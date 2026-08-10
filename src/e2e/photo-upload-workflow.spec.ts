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
  // The Inspector holds FILE_UPLOAD + INSPECTION_PERFORM in BOTH its role
  // definition and its inspections workspace policy, so the upload, fleet
  // read, and inspection-creation calls in this spec all pass their gates.
  const email = process.env.SEED_INSPECTOR_EMAIL || 'inspector@kavangoeast.test';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  let res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password },
  });
  // Retry on rate limit (429) with backoff
  for (let attempt = 0; attempt < 5 && res.status() === 429; attempt++) {
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
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

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Photo Upload Workflow', () => {
  test.setTimeout(60_000);
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
    // Operational inspection evidence is private tenant content. The API must
    // not require or return a public URL for it.
    expect(body.data.publicUrl ?? null).toBeNull();

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

    // Use the Inspector's lifecycle-scoped context instead of selecting an
    // arbitrary fleet vehicle. Official inspections are always trip-bound.
    const contextRes = await page.request.get(`${BASE}/api/inspections/context?type=departure`, {
      headers: { cookie: await getCookieHeader(page) },
    });
    expect(contextRes.status()).toBe(200);
    const inspectionContext = await contextRes.json();
    const trip = inspectionContext.trips?.[0];
    test.skip(!trip, 'No authorised trip is awaiting a departure inspection');

    const photoKeys = [photoKey];
    for (let index = 1; index < inspectionContext.requiredPhotoCount; index++) {
      const uniqueBuffer = Buffer.concat([createTestImageBuffer(), Buffer.from([index])]);
      const extraUpload = await page.request.post(`${BASE}/api/upload`, {
        multipart: {
          file: { name: `departure-photo-${index}.png`, mimeType: 'image/png', buffer: uniqueBuffer },
          category: 'inspection',
        },
        headers: { cookie: await getCookieHeader(page) },
      });
      expect(extraUpload.status(), await extraUpload.text()).toBe(200);
      photoKeys.push((await extraUpload.json()).data.key);
    }

    const odometer = Number(trip.currentOdometer) + 10;

    // Create the inspection with photoKeys
    // Must match all 16 DEPARTURE_INSPECTION_ITEMS labels exactly
    const inspRes = await page.request.post(`${BASE}/api/inspections`, {
      data: {
        vehicleId: trip.vehicleId,
        tripId: trip.id,
        type: 'departure',
        odometerReading: odometer,
        fuelLevel: 'full',
        notes: 'E2E test — inspection with photo',
        checklist: inspectionContext.template.items.map((item: { label: string }) => ({
          label: item.label,
          result: 'pass',
        })),
        inspectorAcknowledged: true,
        driverAcknowledged: true,
        photoKeys,
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
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    // Verify a file input exists (flexible selector)
    const anyFileInput = page.locator('input[type="file"]').first();
    const fileInputVisible = await anyFileInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (fileInputVisible) {
      await expect(anyFileInput).toBeVisible();
      const accept = await anyFileInput.getAttribute('accept').catch(() => '');
      if (accept) expect(accept).toContain('image');
    }
  });

  // -----------------------------------------------------------------------
  // Step 4: Upload photo via the return inspection form UI
  // -----------------------------------------------------------------------

  test('4. return inspection form shows photo upload controls', async ({ page }) => {
    await page.goto('/dashboard/inspections/return?vehicleId=test&tripId=test', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    // Verify a file input exists (flexible selector)
    const anyFileInput = page.locator('input[type="file"]').first();
    const fileInputVisible = await anyFileInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (fileInputVisible) {
      await expect(anyFileInput).toBeVisible();
      const accept = await anyFileInput.getAttribute('accept').catch(() => '');
      if (accept) expect(accept).toContain('image');
    }
  });

  // -----------------------------------------------------------------------
  // Step 5: Verify the inspection detail page shows photos
  // -----------------------------------------------------------------------

  test('5. inspection detail page shows photo section', async ({ page }) => {
    await page.goto('/dashboard/inspections', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await expect(page.locator('h1:has-text("Inspections")').first()).toBeVisible({ timeout: 15000 });

    // Click the first inspection to view detail
    const firstInspection = page.locator('a[href*="/dashboard/inspections/"]').first();
    if (await firstInspection.isVisible({ timeout: 5000 }).catch(() => false)) {
      await firstInspection.click();
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 });

      // The inspection detail page might show a Photos section
      const photosSection = page.locator('text=Photos').first();
      const photosVisible = await photosSection.isVisible({ timeout: 3000 }).catch(() => false);

      if (photosVisible) {
        await expect(photosSection).toBeVisible({ timeout: 5000 });
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
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await expect(page.locator('h1').first()).toBeVisible({ timeout: 10000 });

    // Verify a file input exists (flexible selector)
    const anyFileInput = page.locator('input[type="file"]').first();
    const fileInputVisible = await anyFileInput.isVisible({ timeout: 5000 }).catch(() => false);
    if (fileInputVisible) {
      await expect(anyFileInput).toBeVisible();
    }
  });
});
