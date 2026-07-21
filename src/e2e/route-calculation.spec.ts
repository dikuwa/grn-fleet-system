/**
 * Route Calculation — End-to-End Test
 *
 * Verifies the Google Maps Distance Matrix integration via /api/routes/calculate:
 *   1. Route calculator reports as configured
 *   2. Single route returns distance, duration, coordinates, polyline
 *   3. Multi-leg calculation aggregates correctly
 *   4. Invalid locations return 422
 *   5. Unauthenticated requests return 401
 *   6. Route calculation + save to transport request works
 */

import { test, expect, Page } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

async function signIn(page: Page) {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@kavangoeast.gov.na';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const res = await page.request.post(`${BASE}/api/auth/sign-in`, {
    data: { email, password },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  // The auth API returns the token directly, not as body.session.token
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

test.describe('Route Calculation', () => {
  let session: { token: string; user: { id?: string } };

  // Sign in once before all tests — avoids rate limiting (429) from repeated auth calls
  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    session = await signIn(page);
    await page.close();
  });

  test.beforeEach(async ({ page }) => {
    // Re-hydrate the session cookie for each test context
    await page.context().addCookies([
      {
        name: 'better-auth.session_token',
        value: session.token,
        domain: new URL(BASE).hostname,
        path: '/',
        httpOnly: false,
        sameSite: 'Lax',
      },
    ]);
  });

  // -----------------------------------------------------------------------
  // 1. Route calculator reports as configured
  // -----------------------------------------------------------------------

  test('1. route calculator is configured and responsive', async ({ page }) => {
    const cookie = await getCookieHeader(page);
    const res = await page.request.post(`${BASE}/api/routes/calculate`, {
      data: {
        origin: 'Rundu, Namibia',
        destination: 'Windhoek, Namibia',
      },
      headers: { cookie },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();

    // Should report as configured (Google Maps key is deployed)
    expect(body.configured).toBe(true);

    // Should return route data
    expect(body.routes).toBeDefined();
    expect(Array.isArray(body.routes)).toBe(true);
    expect(body.routes.length).toBeGreaterThan(0);

    const route = body.routes[0];
    expect(route.distanceKm).toBeGreaterThan(0);
    expect(route.durationMinutes).toBeGreaterThan(0);
    expect(route.originName).toContain('Rundu');
    expect(route.destinationName).toContain('Windhoek');

    // Should have coordinates and place IDs
    expect(route.originLat).toBeDefined();
    expect(route.originLng).toBeDefined();
    expect(route.destLat).toBeDefined();
    expect(route.destLng).toBeDefined();
    expect(route.originPlaceId).toBeTruthy();
    expect(route.destinationPlaceId).toBeTruthy();

    // Should have a route polyline (needed for map visualization)
    expect(route.routePolyline).toBeTruthy();
    expect(typeof route.routePolyline).toBe('string');
    expect(route.routePolyline.length).toBeGreaterThan(10);
  });

  // -----------------------------------------------------------------------
  // 2. Multi-leg route calculation
  // -----------------------------------------------------------------------

  test('2. multi-leg route calculation aggregates correctly', async ({ page }) => {
    const cookie = await getCookieHeader(page);
    const res = await page.request.post(`${BASE}/api/routes/calculate`, {
      data: {
        legs: [
          { origin: 'Rundu, Namibia', destination: 'Grootfontein, Namibia' },
          { origin: 'Grootfontein, Namibia', destination: 'Windhoek, Namibia' },
        ],
      },
      headers: { cookie },
    });

    expect(res.status()).toBe(200);
    const body = await res.json();

    expect(body.configured).toBe(true);
    expect(body.totalDistanceKm).toBeGreaterThan(0);
    expect(body.totalDurationMinutes).toBeGreaterThan(0);
    expect(body.routes).toBeDefined();
    expect(body.routes.length).toBe(2);

    // Each leg should have valid data
    for (const route of body.routes) {
      expect(route.distanceKm).toBeGreaterThan(0);
      expect(route.originName).toBeTruthy();
      expect(route.destinationName).toBeTruthy();
      expect(route.routePolyline).toBeTruthy();
    }

    // Total should be sum of individual legs
    const sumDistance = body.routes.reduce((s: number, r: { distanceKm: number }) => s + r.distanceKm, 0);
    expect(body.totalDistanceKm).toBe(sumDistance);
  });

  // -----------------------------------------------------------------------
  // 3. Invalid locations return 422
  // -----------------------------------------------------------------------

  test('3. invalid location names return 422 error', async ({ page }) => {
    const cookie = await getCookieHeader(page);
    const res = await page.request.post(`${BASE}/api/routes/calculate`, {
      data: {
        origin: 'Xyzzyville, Mars',
        destination: 'Narnia, Middle Earth',
      },
      headers: { cookie },
    });

    expect(res.status()).toBe(422);
    const body = await res.json().catch(() => ({}));
    expect(body.error).toBeTruthy();
    expect(body.error).toContain('Could not calculate');
  });

  // -----------------------------------------------------------------------
  // 4. Missing origin/destination returns 400
  // -----------------------------------------------------------------------

  test('4. missing required fields return 400', async ({ page }) => {
    const cookie = await getCookieHeader(page);
    const res = await page.request.post(`${BASE}/api/routes/calculate`, {
      data: {},
      headers: { cookie },
    });

    expect(res.status()).toBe(400);
    const body = await res.json().catch(() => ({}));
    expect(body.error).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 5. Unauthenticated requests return 401
  // -----------------------------------------------------------------------

  test('5. unauthenticated request returns 401', async ({ page }) => {
    const res = await page.request.post(`${BASE}/api/routes/calculate`, {
      data: {
        origin: 'Rundu, Namibia',
        destination: 'Windhoek, Namibia',
      },
    });

    expect(res.status()).toBe(401);
  });

  // -----------------------------------------------------------------------
  // 6. Route calculation with transport request save
  // -----------------------------------------------------------------------

  test('6. creates transport request with route calculation and saves', async ({ page }) => {
    const cookie = await getCookieHeader(page);

    // First create a transport request
    const reqRes = await page.request.post(`${BASE}/api/transport-requests`, {
      data: {
        purpose: 'E2E Test — Route calculation with map save',
        department: 'Transport',
        scope: 'regional',
        activities: [
          {
            title: 'Verify route save',
            startDate: new Date(Date.now() + 86400000).toISOString(),
            endDate: new Date(Date.now() + 86400000 * 2).toISOString(),
            estimatedKilometres: 700,
          },
        ],
      },
      headers: { cookie },
    });
    expect(reqRes.status()).toBe(200);
    const reqBody = await reqRes.json();
    const requestId = reqBody.request?.id;
    expect(requestId).toBeTruthy();

    // Now calculate a route and save it to the transport request
    const calcRes = await page.request.post(`${BASE}/api/routes/calculate`, {
      data: {
        origin: 'Rundu, Namibia',
        destination: 'Windhoek, Namibia',
        requestId,
      },
      headers: { cookie },
    });
    expect(calcRes.status()).toBe(200);
    const calcBody = await calcRes.json();
    expect(calcBody.configured).toBe(true);
    expect(calcBody.routes.length).toBeGreaterThan(0);

    // Verify the route was saved by checking the request detail page
    // Navigate to the request detail page where the route map should show
    await page.goto(`/dashboard/requests/${requestId}`, { waitUntil: 'load', timeout: 60000 });
    await expect(page.locator('h1:has-text("GRN/TR/")').first()).toBeVisible({ timeout: 15000 });

    // The Routes section should have the map and route data
    await expect(page.locator('text=Routes').first()).toBeVisible({ timeout: 10000 });

    // The map container should be rendered (loading the Leaflet map)
    await expect(page.locator('.leaflet-container').first()).toBeAttached({ timeout: 10000 });

    // Route details should show Rundu → Windhoek
    await expect(page.locator('text=Windhoek').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=mapped').first()).toBeAttached({ timeout: 5000 });
  });
});
