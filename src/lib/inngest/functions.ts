/**
 * Inngest — Background Job Functions
 *
 * Defines the handlers for scheduled background jobs:
 *   - workflow/step-reminder:   Remind the assigned approver that action is needed
 *   - workflow/step-escalation:  Escalate an overdue step to a higher authority
 *   - workflow/approval-completed: Send notifications on approval completion
 *
 * These functions are registered with Inngest and run on the Inngest server
 * (or via the dev server during development).
 */

import { inngest, Events } from './client';
import { getDb } from '@/db';
import { workflowInstances, workflowActions } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { notifications } from '@/db/schema/notifications';
import { eq, and } from 'drizzle-orm';

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type EventPayloads = {
  [Events.WORKFLOW_REMINDER]: { workflowInstanceId: string; stepOrder: number };
  [Events.WORKFLOW_ESCALATION]: { workflowInstanceId: string; stepOrder: number };
  [Events.APPROVAL_COMPLETED]: { workflowInstanceId: string; result: string; actorUserId: string };
};

// ---------------------------------------------------------------------------
// Helper: get instance info with tenantId
// ---------------------------------------------------------------------------

async function getInstanceWithTenant(
  workflowInstanceId: string,
): Promise<{ status: string; requestId: string; tenantId: string; currentStepOrder: number } | null> {
  const db = getDb();
  const [row] = await db
    .select({
      status: workflowInstances.status,
      requestId: workflowInstances.requestId,
      currentStepOrder: workflowInstances.currentStepOrder,
      tenantId: transportRequests.tenantId,
    })
    .from(workflowInstances)
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .where(eq(workflowInstances.id, workflowInstanceId))
    .limit(1);

  return row || null;
}

// ---------------------------------------------------------------------------
// Step Reminder
// ---------------------------------------------------------------------------

export const stepReminder = inngest
  ? inngest.createFunction(
      { id: 'workflow-step-reminder', retries: 2 },
      { event: Events.WORKFLOW_REMINDER },
      async ({ event, step }) => {
        const { workflowInstanceId, stepOrder } = event.data as EventPayloads[typeof Events.WORKFLOW_REMINDER];

        return step.run('Send reminder notification', async () => {
          const db = getDb();
          const instance = await getInstanceWithTenant(workflowInstanceId);

          if (!instance || instance.status !== 'active') {
            return { skipped: true, reason: 'Workflow no longer active' };
          }

          const [action] = await db
            .select()
            .from(workflowActions)
            .where(
              and(
                eq(workflowActions.instanceId, workflowInstanceId),
                eq(workflowActions.stepOrder, stepOrder),
              ),
            )
            .limit(1);

          if (action) {
            return { skipped: true, reason: 'Step already completed' };
          }

          const [notif] = await db
            .insert(notifications)
            .values({
              tenantId: instance.tenantId,
              recipientUserId: instance.requestId,
              type: 'reminder',
              title: 'Workflow Action Reminder',
              body: `Step ${stepOrder} requires attention in workflow ${workflowInstanceId.slice(0, 8)}.`,
              entityType: 'workflow_instance',
              entityId: workflowInstanceId,
              priority: 'normal',
              isRead: false,
            })
            .returning();

          return { sent: true, notificationId: notif.id };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Step Escalation
// ---------------------------------------------------------------------------

export const stepEscalation = inngest
  ? inngest.createFunction(
      { id: 'workflow-step-escalation', retries: 2 },
      { event: Events.WORKFLOW_ESCALATION },
      async ({ event, step }) => {
        const { workflowInstanceId, stepOrder } = event.data as EventPayloads[typeof Events.WORKFLOW_ESCALATION];

        return step.run('Send escalation notification', async () => {
          const db = getDb();
          const instance = await getInstanceWithTenant(workflowInstanceId);

          if (!instance || instance.status !== 'active') {
            return { skipped: true, reason: 'Workflow no longer active' };
          }

          const [action] = await db
            .select()
            .from(workflowActions)
            .where(
              and(
                eq(workflowActions.instanceId, workflowInstanceId),
                eq(workflowActions.stepOrder, stepOrder),
              ),
            )
            .limit(1);

          if (action) {
            return { skipped: true, reason: 'Step already completed' };
          }

          const [notif] = await db
            .insert(notifications)
            .values({
              tenantId: instance.tenantId,
              recipientUserId: instance.requestId,
              type: 'escalation',
              title: '⚠️ Workflow Escalation',
              body: `Step ${stepOrder} in workflow ${workflowInstanceId.slice(0, 8)} has exceeded its time limit and requires escalation.`,
              entityType: 'workflow_instance',
              entityId: workflowInstanceId,
              priority: 'high',
              isRead: false,
            })
            .returning();

          return { sent: true, notificationId: notif.id };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Approval Completed Notification
// ---------------------------------------------------------------------------

export const approvalCompleted = inngest
  ? inngest.createFunction(
      { id: 'workflow-approval-completed', retries: 1 },
      { event: Events.APPROVAL_COMPLETED },
      async ({ event, step }) => {
        const { workflowInstanceId, result, actorUserId } = event.data as EventPayloads[typeof Events.APPROVAL_COMPLETED];

        return step.run('Send approval notification', async () => {
          const db = getDb();
          const instance = await getInstanceWithTenant(workflowInstanceId);

          if (!instance) {
            return { skipped: true, reason: 'Workflow instance not found' };
          }

          const title =
            result === 'approved'
              ? '✅ Request Approved'
              : result === 'rejected'
                ? '❌ Request Rejected'
                : '↩️ Request Returned';

          const [notif] = await db
            .insert(notifications)
            .values({
              tenantId: instance.tenantId,
              recipientUserId: actorUserId,
              type: 'outcome',
              title,
              body: `Workflow ${workflowInstanceId.slice(0, 8)}: ${result} by user ${actorUserId}.`,
              entityType: 'workflow_instance',
              entityId: workflowInstanceId,
              priority: 'normal',
              isRead: false,
            })
            .returning();

          return { sent: true, notificationId: notif.id };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Register all functions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Expiry Alert Cron: Vehicle Licence
// ---------------------------------------------------------------------------

export const vehicleLicenceExpiryAlert = inngest
  ? inngest.createFunction(
      { id: 'vehicle-licence-expiry-alert', retries: 2 },
      { cron: '0 8 * * *' }, // Daily at 08:00
      async ({ step }) => {
        return step.run('Check vehicle licence expiry', async () => {
          const db = getDb();
          const { vehicles } = await import('@/db/schema/fleet');
          const { lte } = await import('drizzle-orm');
          const { isBusinessDay } = await import('@/lib/business-day');

          const today = new Date();

          const thirtyDays = new Date();
          thirtyDays.setDate(thirtyDays.getDate() + 30);

          // Fetch expiring licences tenantIds first so we can check per-tenant
          const expiringSoon = await db
            .select({
              vehicleId: vehicles.id,
              licenceNumber: vehicles.licenceNumber,
              licenceExpiryDate: vehicles.licenceExpiryDate,
              tenantId: vehicles.tenantId,
            })
            .from(vehicles)
            .where(
              lte(vehicles.licenceExpiryDate, thirtyDays.toISOString().split('T')[0]),
            );

          // Track which tenants we've already checked today (cache)
          const vehicleBdCache = new Map<string, boolean>();

          let notificationCount = 0;
          for (const v of expiringSoon) {
            // Check business day once per tenant
            if (!vehicleBdCache.has(v.tenantId)) {
              vehicleBdCache.set(v.tenantId, await isBusinessDay(v.tenantId, today));
            }
            if (!vehicleBdCache.get(v.tenantId)) continue;

            const daysLeft = v.licenceExpiryDate
              ? Math.ceil((new Date(v.licenceExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
              : 0;

            await db
              .insert(notifications)
              .values({
                tenantId: v.tenantId,
                recipientUserId: '00000000-0000-0000-0000-000000000000',
                type: 'reminder',
                title: '🚛 Vehicle Licence Expiring',
                body: `${v.licenceNumber} licence expires${daysLeft > 0 ? ` in ${daysLeft} day(s)` : ' today'}.`,
                entityType: 'vehicle',
                entityId: v.vehicleId,
                actionUrl: `/dashboard/fleet/${v.vehicleId}`,
                priority: daysLeft <= 7 ? 'high' : 'normal',
              });
            notificationCount++;
          }

          return { sent: notificationCount > 0, count: notificationCount };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Expiry Alert Cron: Driver Licence
// ---------------------------------------------------------------------------

export const driverLicenceExpiryAlert = inngest
  ? inngest.createFunction(
      { id: 'driver-licence-expiry-alert', retries: 2 },
      { cron: '0 8 * * *' }, // Daily at 08:00
      async ({ step }) => {
        return step.run('Check driver licence expiry', async () => {
          const db = getDb();
          const { driverProfiles, driverLicences } = await import('@/db/schema/people');
          const { employees } = await import('@/db/schema/people');
          const { lte } = await import('drizzle-orm');
          const { isBusinessDay } = await import('@/lib/business-day');

          const today = new Date();
          const thirtyDays = new Date();
          thirtyDays.setDate(thirtyDays.getDate() + 30);

          const [emailModule] = await Promise.all([
            import('@/lib/email'),
          ]);
          const sendEmail = emailModule.sendNotificationEmail;

          const expiringLicences = await db
            .select({
              licenceId: driverLicences.id,
              licenceNumber: driverLicences.licenceNumber,
              licenceClass: driverLicences.licenceClass,
              expiryDate: driverLicences.expiryDate,
              driverProfileId: driverLicences.driverProfileId,
              employeeId: driverProfiles.employeeId,
              firstName: employees.firstName,
              lastName: employees.lastName,
              email: employees.email,
              tenantId: employees.tenantId,
            })
            .from(driverLicences)
            .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
            .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
            .where(
              lte(driverLicences.expiryDate, thirtyDays.toISOString().split('T')[0]),
            );

          // Track which tenants we've already checked today (cache)
          const businessDayCache = new Map<string, boolean>();

          for (const l of expiringLicences) {
            // Check business day once per tenant
            if (!businessDayCache.has(l.tenantId)) {
              businessDayCache.set(l.tenantId, await isBusinessDay(l.tenantId, today));
            }
            if (!businessDayCache.get(l.tenantId)) continue;

            const daysLeft = Math.ceil((new Date(l.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
            const isExpired = daysLeft <= 0;

            await db.insert(notifications).values({
              tenantId: l.tenantId,
              recipientUserId: '00000000-0000-0000-0000-000000000000',
              type: 'reminder',
              title: '🚗 Driver Licence Expiring',
              body: `${l.firstName} ${l.lastName} — ${l.licenceClass} licence expires${daysLeft > 0 ? ` in ${daysLeft} day(s)` : ' today'}.`,
              entityType: 'driver_licence',
              entityId: l.licenceId,
              priority: daysLeft <= 7 ? 'high' : 'normal',
            });

            // Check notification preferences before sending email
            if (l.email && sendEmail) {
              const { notificationPreferences } = await import('@/db/schema/notifications');
              const { eq } = await import('drizzle-orm');
              const [prefs] = await db
                .select({ emailNotifications: notificationPreferences.emailNotifications })
                .from(notificationPreferences)
                .where(
                  and(
                    eq(notificationPreferences.tenantId, l.tenantId),
                    eq(notificationPreferences.userId, l.email),
                  ),
                )
                .limit(1);

              // Send if preferences allow it or no preferences set (default to true)
              const shouldSend = prefs === undefined || prefs.emailNotifications !== false;

              if (shouldSend) {
                await sendEmail({
                  to: l.email,
                  type: 'reminder',
                  title: isExpired
                    ? '⚠️ Your Driver Licence Has Expired'
                    : `⚠️ Your Driver Licence Expires in ${daysLeft} Days`,
                  body: isExpired
                    ? `Your ${l.licenceClass} driver licence (${l.licenceNumber}) expired on ${l.expiryDate}. Please renew it immediately to remain authorised to drive.`
                    : `Your ${l.licenceClass} driver licence (${l.licenceNumber}) will expire on ${l.expiryDate} (${daysLeft} days). Please arrange renewal before the expiry date.`,
                  actionUrl: `/dashboard/drivers/${l.employeeId}`,
                  recipientName: `${l.firstName} ${l.lastName}`,
                });
              }
            }
          }

          return { sent: expiringLicences.length > 0, count: expiringLicences.length };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Maintenance Reminder Cron
// ---------------------------------------------------------------------------

export const maintenanceReminder = inngest
  ? inngest.createFunction(
      { id: 'maintenance-reminder', retries: 2 },
      { cron: '0 8 * * 1' }, // Weekly on Monday at 08:00
      async ({ step }) => {
        return step.run('Check upcoming maintenance', async () => {
          const db = getDb();
          const { maintenanceEvents, vehicles } = await import('@/db/schema/fleet');
          const { lte } = await import('drizzle-orm');
          const { isBusinessDay } = await import('@/lib/business-day');

          const today = new Date();
          const fourteenDays = new Date();
          fourteenDays.setDate(fourteenDays.getDate() + 14);

          const upcomingMaintenance = await db
            .select({
              eventId: maintenanceEvents.id,
              description: maintenanceEvents.description,
              serviceDate: maintenanceEvents.serviceDate,
              vehicleId: maintenanceEvents.vehicleId,
              licenceNumber: vehicles.licenceNumber,
              tenantId: vehicles.tenantId,
            })
            .from(maintenanceEvents)
            .innerJoin(vehicles, eq(maintenanceEvents.vehicleId, vehicles.id))
            .where(
              and(
                lte(maintenanceEvents.nextServiceDate, fourteenDays.toISOString().split('T')[0]),
                eq(maintenanceEvents.serviceType, 'scheduled'),
              ),
            );

          // Track which tenants we've already checked today (cache)
          const maintenanceBusinessDayCache = new Map<string, boolean>();

          for (const m of upcomingMaintenance) {
            // Check business day once per tenant
            if (!maintenanceBusinessDayCache.has(m.tenantId)) {
              maintenanceBusinessDayCache.set(m.tenantId, await isBusinessDay(m.tenantId, today));
            }
            if (!maintenanceBusinessDayCache.get(m.tenantId)) continue;

            await db.insert(notifications).values({
              tenantId: m.tenantId,
              recipientUserId: '00000000-0000-0000-0000-000000000000',
              type: 'reminder',
              title: '🔧 Scheduled Maintenance Due',
              body: `${m.licenceNumber} — ${m.description} due on ${m.serviceDate || 'soon'}.`,
              entityType: 'maintenance_event',
              entityId: m.eventId,
              actionUrl: `/dashboard/fleet/${m.vehicleId}`,
              priority: 'normal',
            });
          }

          return { sent: upcomingMaintenance.length > 0, count: upcomingMaintenance.length };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Register all functions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Document Expiry Alert Cron
// ---------------------------------------------------------------------------

export const documentExpiryAlert = inngest
  ? inngest.createFunction(
      { id: 'document-expiry-alert', retries: 2 },
      { cron: '0 8 * * *' }, // Daily at 08:00
      async ({ step }) => {
        return step.run('Check document expiry dates', async () => {
          const db = getDb();
          const { generatedDocuments } = await import('@/db/schema/documents');
          const { gte, lte, not, eq: eqOp } = await import('drizzle-orm');
          const { isBusinessDay } = await import('@/lib/business-day');

          const today = new Date();
          const thirtyDays = new Date();
          thirtyDays.setDate(thirtyDays.getDate() + 30);

          // Find documents expiring within 30 days that have an expiresAt set
          const expiringDocs = await db
            .select({
              docId: generatedDocuments.id,
              documentType: generatedDocuments.documentType,
              documentVersion: generatedDocuments.documentVersion,
              entityType: generatedDocuments.entityType,
              entityId: generatedDocuments.entityId,
              expiresAt: generatedDocuments.expiresAt,
              tenantId: generatedDocuments.tenantId,
            })
            .from(generatedDocuments)
            .where(
              and(
                gte(generatedDocuments.expiresAt, today),
                lte(generatedDocuments.expiresAt, thirtyDays),
                not(eqOp(generatedDocuments.status, 'superseded')),
              ),
            );

          if (expiringDocs.length === 0) {
            return { skipped: true, reason: 'No documents expiring within 30 days' };
          }

          // Group by tenant for business-day check
          const expiryBdCache = new Map<string, boolean>();

          for (const doc of expiringDocs) {
            const expiresAt = doc.expiresAt ? new Date(doc.expiresAt) : null;
            if (!expiresAt) continue;

            // Check business day once per tenant
            if (!expiryBdCache.has(doc.tenantId)) {
              expiryBdCache.set(doc.tenantId, await isBusinessDay(doc.tenantId, today));
            }
            if (!expiryBdCache.get(doc.tenantId)) continue;

            const daysRemaining = Math.ceil((expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            const isExpired = daysRemaining <= 0;
            const label = doc.documentType.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

            await db.insert(notifications).values({
              tenantId: doc.tenantId,
              recipientUserId: '00000000-0000-0000-0000-000000000000',
              type: 'reminder',
              title: isExpired
                ? `📄 Document Expired: ${label}`
                : `📄 Document Expiring: ${label} (${daysRemaining} days)`,
              body: `${label} v${doc.documentVersion} ${isExpired ? `expired on ${expiresAt.toISOString().split('T')[0]}` : `will expire on ${expiresAt.toISOString().split('T')[0]} (${daysRemaining} days remaining)`}.`,
              entityType: doc.entityType,
              entityId: doc.entityId,
              actionUrl: `/dashboard/documents/${doc.docId}`,
              priority: daysRemaining <= 7 ? 'high' : 'normal',
            });
          }

          return { sent: true, count: expiringDocs.length };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Register all functions
// ---------------------------------------------------------------------------

/** Array of all registered Inngest functions (with nulls filtered out) */
export const inngestFunctions = (
  [
    stepReminder,
    stepEscalation,
    approvalCompleted,
    vehicleLicenceExpiryAlert,
    driverLicenceExpiryAlert,
    maintenanceReminder,
    documentExpiryAlert,
  ] as const
).filter((f): f is NonNullable<typeof f> => f !== null);
