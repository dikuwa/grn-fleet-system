import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
} from '@playwright/test';
import { and, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import { notifications, transportRequests, workflowInstances } from '@/db/schema';

const BASE = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'changeme';

async function login(email: string) {
  const api = await playwrightRequest.newContext({ baseURL: BASE });
  const response = await api.post('/api/auth/sign-in', { data: { email, password: PASSWORD } });
  expect(response.status(), `login ${email}`).toBe(200);
  return api;
}

async function createRegionalRequest(requester: APIRequestContext, label: string) {
  const offset = parseInt(crypto.randomUUID().slice(0, 6), 16) % 10_000;
  const start = new Date(Date.now() + (48 + offset) * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 3 * 60 * 60 * 1000);
  const response = await requester.post('/api/transport-requests', {
    headers: { 'idempotency-key': crypto.randomUUID() },
    data: {
      purpose: label,
      scope: 'regional',
      activities: [
        {
          title: label,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
          estimatedKilometres: 80,
        },
      ],
    },
  });
  expect(response.status(), await response.text()).toBe(200);
  const body = await response.json();
  return {
    requestId: body.request.id as string,
    workflowId: body.request.workflowInstanceId as string,
  };
}

async function actionRequiredNotificationIds(workflowId: string) {
  const db = getDb();
  const rows = await db
    .select({ id: notifications.id, status: notifications.status })
    .from(notifications)
    .where(
      and(
        eq(notifications.entityId, workflowId),
        eq(notifications.type, 'action_required'),
      ),
    );
  return rows.map((row) => row.id);
}

async function expectNotificationsResolved(ids: string[]) {
  expect(ids.length, 'expected at least one action-required notification').toBeGreaterThan(0);
  const db = getDb();
  const rows = await db
    .select({ id: notifications.id, status: notifications.status, resolvedAt: notifications.resolvedAt })
    .from(notifications)
    .where(inArray(notifications.id, ids));
  expect(rows).toHaveLength(ids.length);
  for (const row of rows) {
    expect(row.status, `notification ${row.id}`).toBe('resolved');
    expect(row.resolvedAt, `notification ${row.id} resolvedAt`).toBeTruthy();
  }
}

test.describe.serial('Request return/resubmit and cancellation notification closure', () => {
  test.setTimeout(300_000);

  test('returned request resolves abandoned approval work and resubmission creates a fresh workflow', async () => {
    const requester = await login('requester@kavangoeast.test');
    const supervisor = await login('supervisor@kavangoeast.test');
    const created = await createRegionalRequest(requester, 'E2E return and resubmit closure');

    const initialNotificationIds = await actionRequiredNotificationIds(created.workflowId);
    expect(initialNotificationIds.length).toBeGreaterThan(0);

    const returned = await supervisor.post(`/api/approvals/${created.workflowId}/action`, {
      data: {
        actionType: 'returned',
        comment: 'Please correct the operational justification before resubmission.',
      },
    });
    expect(returned.status(), await returned.text()).toBe(200);
    await expectNotificationsResolved(initialNotificationIds);

    const db = getDb();
    const [returnedRequest] = await db
      .select({ status: transportRequests.status })
      .from(transportRequests)
      .where(eq(transportRequests.id, created.requestId))
      .limit(1);
    expect(returnedRequest?.status).toBe('returned');

    const resubmitted = await requester.post(`/api/requests/${created.requestId}/resubmit`, {
      data: { reason: 'Operational justification corrected after supervisor feedback.' },
    });
    expect(resubmitted.status(), await resubmitted.text()).toBe(200);
    const resubmittedBody = await resubmitted.json();
    const replacementWorkflowId = resubmittedBody.workflowInstanceId as string;
    expect(replacementWorkflowId).toBeTruthy();
    expect(replacementWorkflowId).not.toBe(created.workflowId);

    const [oldWorkflow] = await db
      .select({ status: workflowInstances.status })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, created.workflowId))
      .limit(1);
    const [newWorkflow] = await db
      .select({ status: workflowInstances.status })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, replacementWorkflowId))
      .limit(1);
    expect(oldWorkflow?.status).toBe('cancelled');
    expect(newWorkflow?.status).toBe('active');

    const replacementNotificationIds = await actionRequiredNotificationIds(replacementWorkflowId);
    expect(replacementNotificationIds.length).toBeGreaterThan(0);

    await requester.dispose();
    await supervisor.dispose();
  });

  test('request cancellation resolves the pending approver notification instead of leaving stale action required work', async () => {
    const requester = await login('requester@kavangoeast.test');
    const created = await createRegionalRequest(requester, 'E2E cancellation notification closure');
    const initialNotificationIds = await actionRequiredNotificationIds(created.workflowId);
    expect(initialNotificationIds.length).toBeGreaterThan(0);

    const cancellation = await requester.patch(`/api/requests/${created.requestId}/cancel`, {
      data: { reason: 'Journey cancelled because the field activity is no longer required.' },
    });
    expect(cancellation.status(), await cancellation.text()).toBe(200);
    await expectNotificationsResolved(initialNotificationIds);

    const db = getDb();
    const [request] = await db
      .select({ status: transportRequests.status })
      .from(transportRequests)
      .where(eq(transportRequests.id, created.requestId))
      .limit(1);
    const [workflow] = await db
      .select({ status: workflowInstances.status })
      .from(workflowInstances)
      .where(eq(workflowInstances.id, created.workflowId))
      .limit(1);
    expect(request?.status).toBe('cancelled');
    expect(workflow?.status).toBe('cancelled');

    await requester.dispose();
  });
});
