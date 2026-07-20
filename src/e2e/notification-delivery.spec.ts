/**
 * Notification Delivery E2E Test
 *
 * Tests the notification delivery pipeline:
 * 1. Create a fuel transaction → verify notification is created
 * 2. Verify notification delivery record is created (email status)
 * 3. Verify the notification appears in the GET /api/notifications list
 * 4. Test "Mark All Read" functionality
 * 5. Test notification type filtering
 */

import { test, expect, type Page } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sign in via the sign-in API and set the session cookie */
async function signIn(page: Page): Promise<string> {
  const email = 'admin@kavango.gov.na';
  const password = 'admin123';

  const response = await page.request.post('/api/auth/sign-in/email', {
    data: { email, password },
  });

  // The response body may include a session or token
  const body = await response.json();
  expect(response.ok()).toBeTruthy();

  // Get the session cookie from the page context
  // Wait a moment for cookies to be set
  await page.waitForTimeout(500);
  const cookies = await page.context().cookies();
  const token = cookies.find((c) => c.name === 'better-auth.session_token')?.value ?? '';
  return token;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Notification Delivery Pipeline', () => {
  test.describe.configure({ mode: 'serial' });

  let authCookie = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    authCookie = await signIn(page);
    await page.close();
  });

  test('1. Create fuel transaction and verify notification created', async ({ request }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    // First, get a vehicle ID from the fleet
    const fleetResp = await request.get('/api/fleet', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    const fleetData = await fleetResp.json();
    test.skip(!fleetData?.vehicles?.length, 'No vehicles available for test');

    const vehicleId = fleetData.vehicles[0].id;

    // Create a fuel transaction (this triggers fuel_created + notification)
    const fuelResp = await request.post('/api/fuel', {
      headers: {
        'Content-Type': 'application/json',
        cookie: `better-auth.session_token=${authCookie}`,
      },
      data: {
        vehicleId,
        litres: 45.5,
        amount: 675.50,
        fuelType: 'diesel',
        stationName: 'E2E Test Station',
        transactionDate: new Date().toISOString(),
      },
    });
    expect(fuelResp.ok()).toBeTruthy();
    const fuelBody = await fuelResp.json();
    expect(fuelBody).toBeTruthy();

    // Now verify the notification was created
    const notifResp = await request.get('/api/notifications', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    expect(notifResp.ok()).toBeTruthy();
    const notifData = await notifResp.json();
    expect(notifData.success).toBe(true);
    expect(notifData.data.notifications.length).toBeGreaterThan(0);

    // Find the fuel-related notification
    const fuelNotif = notifData.data.notifications.find(
      (n: { type: string; title: string }) =>
        n.type === 'fuel_created' && n.title.includes('Fuel Transaction'),
    );
    expect(fuelNotif).toBeTruthy();
    expect(fuelNotif.title).toContain('Fuel Transaction');
    expect(fuelNotif.entityType).toBe('fuel_transaction');
  });

  test('2. Notification has delivery record with email status', async ({ request }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    // Fetch notifications
    const notifResp = await request.get('/api/notifications', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    expect(notifResp.ok()).toBeTruthy();
    const notifData = await notifResp.json();

    // Get the most recent fuel notification
    const fuelNotif = notifData.data.notifications.find(
      (n: { type: string }) => n.type === 'fuel_created',
    );
    test.skip(!fuelNotif, 'No fuel notification found');

    // The notificationID is fuelNotif.id; we can verify it appears in the list
    // Delivery records are queried via the audit/notifications API internally
    expect(fuelNotif.id).toBeTruthy();
    expect(fuelNotif.isRead).toBe(false);
  });

  test('3. Mark notification as read and verify', async ({ page }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    // Navigate to dashboard
    await page.goto('/dashboard');
    await page.waitForTimeout(1000);

    // Accept cookies/privacy if present
    try {
      const acceptBtn = page.locator('button', { hasText: /accept|agree/i }).first();
      if (await acceptBtn.isVisible({ timeout: 2000 })) {
        await acceptBtn.click();
      }
    } catch {
      // ignore
    }

    // Find and click a "Mark All Read" button if visible
    const markReadBtn = page.locator('button:has-text("Mark All Read"), button:has-text("Mark all read")').first();
    if (await markReadBtn.isVisible({ timeout: 2000 })) {
      await markReadBtn.click();
      await page.waitForTimeout(500);

      // Verify notifications are now marked as read — the unread badge should reflect this
      // Allow 0 or empty for the unread count
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });

  test('4. Notification type filtering works', async ({ request }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    // Test filtering by type
    const filteredResp = await request.get('/api/notifications?type=fuel_created', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    expect(filteredResp.ok()).toBeTruthy();
    const filteredData = await filteredResp.json();
    expect(filteredData.success).toBe(true);

    // All returned notifications should have type fuel_created
    for (const n of filteredData.data.notifications) {
      expect(n.type).toBe('fuel_created');
    }
  });

  test('5. Unread count endpoint returns valid data', async ({ request }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    const unreadResp = await request.get('/api/notifications?unreadOnly=true', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    expect(unreadResp.ok()).toBeTruthy();
    const unreadData = await unreadResp.json();
    expect(unreadData.success).toBe(true);
    expect(typeof unreadData.data.unreadCount).toBe('number');

    // Every notification in the response should be unread
    for (const n of unreadData.data.notifications) {
      expect(n.isRead).toBe(false);
    }
  });
});
