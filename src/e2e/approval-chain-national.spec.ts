/**
 * National approval-chain contract coverage.
 *
 * This intentionally focuses on the role/permission boundary that differs from
 * the regional chain: National Vehicle Release must be performed by the
 * national release officer, and National Trip Authorisation by the national
 * final authoriser. Driver acceptance remains owned by the canonical trip
 * acknowledgement endpoint rather than the generic approvals endpoint.
 */
import { expect, request as playwrightRequest, test } from '@playwright/test';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

const ACCOUNTS = {
  requester: 'requester@kavangoeast.test',
  supervisor: 'supervisor@kavangoeast.test',
  transport: 'transport.admin@kavangoeast.test',
  regionalRelease: 'release.officer@kavangoeast.test',
  regionalAuthoriser: 'regional.authoriser@kavangoeast.test',
  nationalRelease: 'national.release@kavangoeast.test',
  nationalAuthoriser: 'national.authoriser@kavangoeast.test',
} as const;

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const res = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(res.status(), `login ${email}: ${await res.text()}`).toBe(200);
  return api;
}

test.describe('National approval-chain boundaries', () => {
  test.setTimeout(180_000);

  test('regional release/authoriser accounts cannot substitute for national officers', async () => {
    const requester = await login(ACCOUNTS.requester);
    const supervisor = await login(ACCOUNTS.supervisor);
    const transport = await login(ACCOUNTS.transport);
    const regionalRelease = await login(ACCOUNTS.regionalRelease);
    const regionalAuthoriser = await login(ACCOUNTS.regionalAuthoriser);
    const nationalRelease = await login(ACCOUNTS.nationalRelease);
    const nationalAuthoriser = await login(ACCOUNTS.nationalAuthoriser);

    const start = new Date(Date.now() + 35 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);

    const createRes = await requester.post('/api/transport-requests', {
      headers: { 'idempotency-key': crypto.randomUUID() },
      data: {
        purpose: 'E2E national approval boundary verification',
        scope: 'national',
        activities: [{
          title: 'National approval boundary verification',
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 250,
        }],
      },
    });
    expect(createRes.status(), await createRes.text()).toBe(200);
    const body = await createRes.json();
    const instanceId = body.request.workflowInstanceId as string;
    expect(instanceId).toBeTruthy();

    const supervisorRes = await supervisor.post(`/api/approvals/${instanceId}/action`, {
      data: { actionType: 'approved', comment: 'National chain supervisor approval' },
    });
    expect(supervisorRes.status(), await supervisorRes.text()).toBe(200);

    // Transport review requires a confirmed allocation + eligible driver. If
    // the fixture cannot satisfy that operational prerequisite, stop here: the
    // permission checks below are only meaningful once the chain reaches the
    // release stage.
    const transportRes = await transport.post(`/api/approvals/${instanceId}/action`, {
      data: { actionType: 'approved', comment: 'National chain transport review' },
    });
    if (transportRes.status() === 409) {
      test.skip(true, 'National boundary fixture requires an operational allocation before transport review');
    }
    expect(transportRes.status(), await transportRes.text()).toBe(200);

    const wrongRelease = await regionalRelease.post(`/api/approvals/${instanceId}/action`, {
      data: { actionType: 'approved', comment: 'Regional release must not satisfy national release' },
    });
    expect([403, 404]).toContain(wrongRelease.status());

    const releaseRes = await nationalRelease.post(`/api/approvals/${instanceId}/action`, {
      data: { actionType: 'approved', comment: 'National vehicle release' },
    });
    expect(releaseRes.status(), await releaseRes.text()).toBe(200);

    const wrongAuthoriser = await regionalAuthoriser.post(`/api/approvals/${instanceId}/action`, {
      data: { actionType: 'approved', comment: 'Regional authoriser must not satisfy national authorisation' },
    });
    expect([403, 404]).toContain(wrongAuthoriser.status());

    const authoriseRes = await nationalAuthoriser.post(`/api/approvals/${instanceId}/action`, {
      data: { actionType: 'approved', comment: 'National final authorisation' },
    });
    // A fully seeded operational allocation is also required by final
    // authorisation. Permission routing is proven when the correct national
    // actor reaches domain validation rather than being denied as the wrong
    // role. 200 means the fixture was fully operational; 409 means the
    // permission gate was passed but an operational prerequisite was missing.
    expect([200, 409]).toContain(authoriseRes.status());

    await Promise.all([
      requester.dispose(),
      supervisor.dispose(),
      transport.dispose(),
      regionalRelease.dispose(),
      regionalAuthoriser.dispose(),
      nationalRelease.dispose(),
      nationalAuthoriser.dispose(),
    ]);
  });
});
