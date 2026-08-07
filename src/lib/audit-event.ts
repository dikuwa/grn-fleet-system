import { getDb } from '@/db';
import { auditEvents } from '@/db/schema/audit';
import { eq, sql } from 'drizzle-orm';

interface AuditEventInput {
  tenantId: string;
  actorUserId: string;
  actorEmployeeId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  eventType?: string;
  sourceChannel?: string;
  before?: unknown;
  after?: unknown;
  summary?: string;
  reason?: string;
  isActing?: boolean;
  roleAssignmentId?: string | null;
  correlationId?: string | null;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

export async function recordAuditEvent(input: AuditEventInput, client?: Tx) {
  const db = client ?? getDb();
  const [sequence] = await db
    .select({ value: sql<number>`COALESCE(MAX(${auditEvents.tenantSequence}), 0) + 1` })
    .from(auditEvents)
    .where(eq(auditEvents.tenantId, input.tenantId));

  await db.insert(auditEvents).values({
    tenantId: input.tenantId,
    tenantSequence: sequence.value,
    eventType: input.eventType || input.entityType,
    actorUserId: input.actorUserId,
    actorEmployeeId: input.actorEmployeeId || null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId || null,
    sourceChannel: input.sourceChannel || 'web',
    before: input.before,
    after: input.after,
    summary: input.summary,
    reason: input.reason,
    isActing: input.isActing || false,
    roleAssignmentId: input.roleAssignmentId || null,
    correlationId: input.correlationId || null,
  });
}
