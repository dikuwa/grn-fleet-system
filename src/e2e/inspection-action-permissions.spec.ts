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
  test('Inspector and Transport Administrator reach inspection execution; requester is denied', async () => {
    const inspector = await signedInApi('inspector');
    const transport = await signedInApi('transport-admin');
    const requester = await signedInApi('requester');

    const inspectorPost = await inspector.post('/api/inspections', {
      data: {},
    });
    // Permission checks run before payload validation. An Inspector therefore
    // reaches the domain validator (400), proving INSPECTION_PERFORM is active.
    expect(inspectorPost.status()).toBe(400);

    const transportPost = await transport.post('/api/inspections', {
      data: {},
    });
    // PR #30 grants TRANSPORT_ADMIN inspection:perform (role grant + workspace
    // policy), so the Transport Administrator reaches the domain validator too.
    expect(transportPost.status()).toBe(400);

    const transportContext = await transport.get('/api/inspections/context?type=departure');
    // The seed guarantees an active departure template (the reservation spec's
    // inspection helper hard-depends on it), so 200 is deterministic — and 403
    // must never be returned to the Transport Administrator anymore.
    expect(transportContext.status()).toBe(200);

    const requesterPost = await requester.post('/api/inspections', {
      data: {},
    });
    // The server-side permission gate still exists: a requester without
    // INSPECTION_PERFORM is denied before payload validation.
    expect(requesterPost.status()).toBe(403);

    await inspector.dispose();
    await transport.dispose();
    await requester.dispose();
  });
});
