import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

test('rejects tenant-wide notification broadcasts', async () => {
  const admin = await playwrightRequest.newContext({ baseURL: BASE });
  try {
    const signIn = await admin.post('/api/auth/sign-in', {
      data: { email: 'admin@kavangoeast.gov.na', password: PASSWORD },
    });
    expect(signIn.status(), await signIn.text()).toBe(200);

    const response = await admin.post('/api/notifications', {
      data: {
        audience: 'tenant',
        type: 'operational',
        title: 'This broadcast must be rejected',
      },
    });
    expect(response.status()).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'Invalid notification audience' });
  } finally {
    await admin.dispose();
  }
});
