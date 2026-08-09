import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function signedInApi(username: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const signIn = await api.post('/api/auth/custom-sign-in', {
    data: { username, password: PASSWORD },
  });
  expect(signIn.status(), await signIn.text()).toBe(200);
  return api;
}

test.describe('official inspection action permissions', () => {
  test('Inspector may reach inspection execution while Transport Administrator may only review', async () => {
    const inspector = await signedInApi('inspector');
    const transport = await signedInApi('transport-admin');

    const inspectorPost = await inspector.post('/api/inspections', {
      data: {},
    });
    // Permission checks run before payload validation. An Inspector therefore
    // reaches the domain validator (400), proving INSPECTION_PERFORM is active.
    expect(inspectorPost.status()).toBe(400);

    const transportPost = await transport.post('/api/inspections', {
      data: {},
    });
    // Transport Administration can schedule/review inspection records but is
    // not an official Inspector and must not perform the inspection itself.
    expect(transportPost.status()).toBe(403);

    const transportContext = await transport.get('/api/inspections/context?type=departure');
    expect(transportContext.status()).toBe(403);

    await inspector.dispose();
    await transport.dispose();
  });
});
