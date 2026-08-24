import { getDb } from '@/db';
import { notifications } from '@/db/schema';

const stageLabels: Record<string, string> = {
  submitted: 'Submitted',
  returned: 'Returned for changes',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
  approved: 'Approved',
  released: 'Released',
  authorised: 'Authorised',
  allocated: 'Vehicle allocated',
  driver_assigned: 'Driver assigned',
  started: 'Trip started',
  completed: 'Trip completed',
  closed: 'Trip closed',
};

/**
 * Write a safe, in-app-only tenant activity event.
 * Never include purpose, passenger names, route, contact details, or free text.
 */
export async function recordTenantRequestActivity(input: {
  tenantId: string;
  requestId: string;
  reference: string;
  stage: keyof typeof stageLabels | string;
  officeLabel?: string | null;
  occurredAt?: Date;
}) {
  const db = getDb();
  const label = stageLabels[input.stage] || input.stage.replaceAll('_', ' ');
  const occurredAt = input.occurredAt || new Date();
  const office = input.officeLabel?.trim() || 'Responsible office';
  await db.insert(notifications).values({
    tenantId: input.tenantId,
    recipientUserId: null,
    audience: 'activity',
    audienceTarget: null,
    type: 'awareness',
    eventType: 'request_progress',
    title: `${input.reference} · ${label}`,
    body: `Stage: ${label} · ${office} · ${occurredAt.toLocaleString('en-NA', { timeZone: 'Africa/Windhoek' })}`,
    entityType: 'transport_request',
    entityId: input.requestId,
    actionUrl: null,
    priority: input.stage === 'rejected' || input.stage === 'returned' ? 'high' : 'normal',
    status: 'archived',
    archivedAt: occurredAt,
    createdAt: occurredAt,
  });
}

export async function recordPlatformActivity(input: {
  tenantId: string;
  type: string;
  title: string;
  body?: string;
  entityType?: string;
  entityId?: string;
}) {
  const db = getDb();
  await db.insert(notifications).values({
    tenantId: input.tenantId,
    recipientUserId: null,
    audience: 'platform',
    audienceTarget: null,
    type: input.type,
    eventType: input.type,
    title: input.title,
    body: input.body || null,
    entityType: input.entityType || null,
    entityId: input.entityId || null,
    actionUrl: '/dashboard/platform',
    requiredRole: SystemPlatformRole,
    workspace: 'platform_admin',
    status: 'unread',
    priority: 'normal',
  });
}

const SystemPlatformRole = 'Platform Super Administrator';