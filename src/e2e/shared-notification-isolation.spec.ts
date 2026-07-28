import { expect, request as playwrightRequest, test } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { notifications } from '@/db/schema/notifications';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', {
    data: { email, password: PASSWORD },
  });
  expect(response.status(), await response.text()).toBe(200);
  return api;
}

test('tenant activity is shared safely with independent read state and eligible links', async () => {
  const admin = await login('admin@kavangoeast.gov.na');
  const requester = await login('requester@kavangoeast.test');
  const driver = await login('driver@kavangoeast.test');
  let notificationId: string | undefined;

  try {
    const title = `E2E safe tenant activity ${crypto.randomUUID()}`;
    const created = await admin.post('/api/notifications', {
      data: {
        audience: 'tenant',
        type: 'operational',
        title,
        body: 'Reference TR-E2E reached the allocated stage.',
        actionUrl: '/dashboard/requests',
      },
    });
    expect(created.status(), await created.text()).toBe(200);
    notificationId = (await created.json()).data.notification.id as string;

    const requesterFeed = await requester.get('/api/notifications');
    const requesterItem = (await requesterFeed.json()).data.notifications.find(
      (item: { id: string }) => item.id === notificationId,
    );
    expect(requesterItem).toMatchObject({
      title,
      audience: 'tenant',
      isRead: false,
      actionUrl: '/dashboard/requests',
    });

    const driverFeed = await driver.get('/api/notifications');
    const driverItem = (await driverFeed.json()).data.notifications.find(
      (item: { id: string }) => item.id === notificationId,
    );
    expect(driverItem).toMatchObject({
      title,
      audience: 'tenant',
      isRead: false,
      actionUrl: null,
    });

    const marked = await requester.patch('/api/notifications', {
      data: { notificationId, action: 'mark_read' },
    });
    expect(marked.status(), await marked.text()).toBe(200);

    const requesterAfter = await requester.get('/api/notifications');
    expect(
      (await requesterAfter.json()).data.notifications.find(
        (item: { id: string }) => item.id === notificationId,
      ).isRead,
    ).toBe(true);

    const driverAfter = await driver.get('/api/notifications');
    expect(
      (await driverAfter.json()).data.notifications.find(
        (item: { id: string }) => item.id === notificationId,
      ).isRead,
    ).toBe(false);
  } finally {
    await Promise.all([admin.dispose(), requester.dispose(), driver.dispose()]);
    if (notificationId) {
      await getDb().delete(notifications).where(eq(notifications.id, notificationId));
    }
  }
});
