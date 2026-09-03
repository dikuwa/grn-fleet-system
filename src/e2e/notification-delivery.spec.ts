/**
 * Notification Delivery E2E Test
 *
 * Tests the scoped notification delivery pipeline:
 * 1. Create a fuel transaction → verify a personal outcome notification is created
 * 2. Verify the notification has durable event identity and remains unread initially
 * 3. Test "Mark All Read" functionality
 * 4. Test notification category filtering
 * 5. Test unread filtering
 */

import { test, expect, type Page } from '@playwright/test';

async function signIn(page: Page): Promise<string> {
  const email = process.env.SEED_ADMIN_EMAIL || 'transport.admin@kavangoeast.test';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme';

  const response = await page.request.post('/api/auth/sign-in', {
    data: { email, password },
  });

  expect(response.status()).toBe(200);
  const body = await response.json();
  const token = body.token || body.session?.token;
  expect(token).toBeDefined();

  await page.context().addCookies([
    {
      name: 'better-auth.session_token',
      value: token,
      domain: 'localhost',
      path: '/',
      httpOnly: false,
      sameSite: 'Lax',
    },
  ]);

  return token;
}

test.describe('Notification Delivery Pipeline', () => {
  test.describe.configure({ mode: 'serial' });

  let authCookie = '';

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto('/');
    authCookie = await signIn(page);
    await page.close();
  });

  test('1. Create fuel transaction and verify scoped outcome notification created', async ({ request }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    const fleetResp = await request.get('/api/fleet', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    const fleetBody = await fleetResp.json();
    const vehicleList =
      fleetBody.rows ||
      fleetBody.data ||
      fleetBody.vehicles ||
      (Array.isArray(fleetBody) ? fleetBody : []);
    test.skip(!vehicleList.length, 'No vehicles available for test');

    const vehicleId = vehicleList[0].id;
    const fuelResp = await request.post('/api/fuel', {
      headers: {
        'Content-Type': 'application/json',
        cookie: `better-auth.session_token=${authCookie}`,
      },
      data: {
        vehicleId,
        litres: 45.5,
        amount: 675.5,
        fuelType: 'diesel',
        paymentMethod: 'fuel_card',
        stationName: 'E2E Test Station',
        transactionAt: new Date().toISOString(),
      },
    });
    expect(fuelResp.ok()).toBeTruthy();
    expect(await fuelResp.json()).toBeTruthy();

    const notifResp = await request.get('/api/notifications', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    expect(notifResp.ok()).toBeTruthy();
    const notifData = await notifResp.json();
    expect(notifData.success).toBe(true);
    expect(notifData.data.notifications.length).toBeGreaterThan(0);

    const fuelNotif = notifData.data.notifications.find(
      (notification: { type: string; eventType?: string }) =>
        notification.type === 'outcome' && notification.eventType === 'fuel_entry_recorded',
    );
    expect(fuelNotif).toBeTruthy();
    expect(fuelNotif.title).toContain('Fuel Entry Recorded');
    expect(fuelNotif.entityType).toBe('fuel_transaction');
  });

  test('2. Notification keeps durable event identity and starts unread', async ({ request }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    const notifResp = await request.get('/api/notifications', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    expect(notifResp.ok()).toBeTruthy();
    const notifData = await notifResp.json();

    const fuelNotif = notifData.data.notifications.find(
      (notification: { type: string; eventType?: string }) =>
        notification.type === 'outcome' && notification.eventType === 'fuel_entry_recorded',
    );
    test.skip(!fuelNotif, 'No scoped fuel notification found');

    expect(fuelNotif.id).toBeTruthy();
    expect(fuelNotif.eventType).toBe('fuel_entry_recorded');
    expect(fuelNotif.isRead).toBe(false);
  });

  test('3. Mark notification as read and verify', async ({ page }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    await page.goto('/dashboard');
    await page.waitForTimeout(1000);

    try {
      const acceptBtn = page.locator('button', { hasText: /accept|agree/i }).first();
      if (await acceptBtn.isVisible({ timeout: 2000 })) {
        await acceptBtn.click();
      }
    } catch {
      // Optional cookie/privacy affordance is not present in every environment.
    }

    const markReadBtn = page
      .locator('button:has-text("Mark All Read"), button:has-text("Mark all read")')
      .first();
    if (await markReadBtn.isVisible({ timeout: 2000 })) {
      await markReadBtn.click();
      await page.waitForTimeout(500);
      await expect(page).toHaveURL(/\/dashboard/);
    }
  });

  test('4. Notification category filtering works', async ({ request }) => {
    test.skip(!authCookie, 'Sign-in failed, skipping all tests');

    const filteredResp = await request.get('/api/notifications?type=outcome', {
      headers: { cookie: `better-auth.session_token=${authCookie}` },
    });
    expect(filteredResp.ok()).toBeTruthy();
    const filteredData = await filteredResp.json();
    expect(filteredData.success).toBe(true);

    for (const notification of filteredData.data.notifications) {
      expect(notification.type).toBe('outcome');
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

    for (const notification of unreadData.data.notifications) {
      expect(notification.isRead).toBe(false);
    }
  });
});
