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
import { workflowInstances, workflowActions, workflowSteps } from '@/db/schema/workflows';
import { transportRequests } from '@/db/schema/requests';
import { eq, and } from 'drizzle-orm';
import { createScopedNotifications, resolveActiveRoleRecipients } from '@/lib/notification-service';
import { SystemRoles, WorkspaceIds } from '@/lib/workspaces';

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

async function getInstanceWithTenant(workflowInstanceId: string): Promise<{
  status: string;
  requestId: string;
  tenantId: string;
  currentStepOrder: number;
  assignedUserId: string | null;
  requesterUserId: string | null;
} | null> {
  const db = getDb();
  const [row] = await db
    .select({
      status: workflowInstances.status,
      requestId: workflowInstances.requestId,
      currentStepOrder: workflowInstances.currentStepOrder,
      tenantId: transportRequests.tenantId,
      assignedUserId: workflowSteps.assignedUserId,
      requesterUserId: transportRequests.requesterUserId,
    })
    .from(workflowInstances)
    .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
    .leftJoin(
      workflowSteps,
      and(
        eq(workflowSteps.definitionId, workflowInstances.definitionId),
        eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
      ),
    )
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
        const { workflowInstanceId, stepOrder } =
          event.data as EventPayloads[typeof Events.WORKFLOW_REMINDER];

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

          if (!instance.assignedUserId) {
            return { skipped: true, reason: 'Workflow step has no current assignee' };
          }
          const [notif] = await createScopedNotifications({
            tenantId: instance.tenantId,
            recipientUserIds: [instance.assignedUserId],
            category: 'reminder',
            eventType: 'approval_due_reminder',
            title: 'Workflow Action Reminder',
            body: `Step ${stepOrder} requires attention in workflow ${workflowInstanceId.slice(0, 8)}.`,
            entityType: 'workflow_instance',
            entityId: workflowInstanceId,
            actionUrl: `/dashboard/approvals/${workflowInstanceId}`,
            workspace: WorkspaceIds.APPROVER,
            workflowStage: String(stepOrder),
            priority: 'normal',
          });

          return { sent: Boolean(notif), notificationId: notif?.id };
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
        const { workflowInstanceId, stepOrder } =
          event.data as EventPayloads[typeof Events.WORKFLOW_ESCALATION];

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

          if (!instance.assignedUserId) {
            return { skipped: true, reason: 'Workflow step has no current assignee' };
          }
          const [notif] = await createScopedNotifications({
            tenantId: instance.tenantId,
            recipientUserIds: [instance.assignedUserId],
            category: 'escalation',
            eventType: 'approval_overdue_escalation',
            title: '⚠️ Workflow Escalation',
            body: `Step ${stepOrder} in workflow ${workflowInstanceId.slice(0, 8)} has exceeded its time limit and requires escalation.`,
            entityType: 'workflow_instance',
            entityId: workflowInstanceId,
            actionUrl: `/dashboard/approvals/${workflowInstanceId}`,
            workspace: WorkspaceIds.APPROVER,
            workflowStage: String(stepOrder),
            priority: 'high',
            mandatory: true,
          });

          return { sent: Boolean(notif), notificationId: notif?.id };
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
        const { workflowInstanceId, result, actorUserId } =
          event.data as EventPayloads[typeof Events.APPROVAL_COMPLETED];

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

          if (!instance.requesterUserId) {
            return { skipped: true, reason: 'Request has no authenticated requester' };
          }
          const [notif] = await createScopedNotifications({
            tenantId: instance.tenantId,
            recipientUserIds: [instance.requesterUserId],
            category: result === 'returned' ? 'action_required' : 'outcome',
            eventType: `request_${result}`,
            title,
            body: `Your request workflow ${workflowInstanceId.slice(0, 8)} was ${result}.`,
            entityType: 'workflow_instance',
            entityId: workflowInstanceId,
            actionUrl: `/dashboard/requests/${instance.requestId}`,
            workspace: WorkspaceIds.PERSONAL,
            priority: 'normal',
          });

          return { sent: Boolean(notif), notificationId: notif?.id, actorUserId };
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
            .where(lte(vehicles.licenceExpiryDate, thirtyDays.toISOString().split('T')[0]));

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
              ? Math.ceil(
                  (new Date(v.licenceExpiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
                )
              : 0;

            const recipients = await resolveActiveRoleRecipients(v.tenantId, [
              SystemRoles.TRANSPORT_ADMIN,
            ]);
            const created = await createScopedNotifications({
              tenantId: v.tenantId,
              recipientUserIds: recipients,
              category: 'reminder',
              eventType: 'vehicle_licence_expiring',
              title: '🚛 Vehicle Licence Expiring',
              body: `${v.licenceNumber} licence expires${daysLeft > 0 ? ` in ${daysLeft} day(s)` : ' today'}.`,
              entityType: 'vehicle',
              entityId: v.vehicleId,
              actionUrl: `/dashboard/fleet/${v.vehicleId}`,
              workspace: WorkspaceIds.TRANSPORT_ADMIN,
              priority: daysLeft <= 7 ? 'high' : 'normal',
            });
            notificationCount += created.length;
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
          const [emailModule] = await Promise.all([import('@/lib/email')]);
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
              userId: employees.userId,
              tenantId: employees.tenantId,
            })
            .from(driverLicences)
            .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
            .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
            .where(
              lte(
                driverLicences.expiryDate,
                new Date(Date.now() + 90 * 86_400_000).toISOString().split('T')[0],
              ),
            );

          // Track which tenants we've already checked today (cache)
          const businessDayCache = new Map<string, boolean>();

          for (const l of expiringLicences) {
            // Check business day once per tenant
            if (!businessDayCache.has(l.tenantId)) {
              businessDayCache.set(l.tenantId, await isBusinessDay(l.tenantId, today));
            }
            if (!businessDayCache.get(l.tenantId)) continue;

            const daysLeft = Math.ceil(
              (new Date(l.expiryDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
            );
            const isExpired = daysLeft <= 0;
            const reminderDay = isExpired
              ? 0
              : [90, 60, 30, 14, 7].find((threshold) => daysLeft === threshold);
            if (reminderDay === undefined || !l.userId) continue;
            const reminderTitle = isExpired
              ? '🚗 Driver Licence Expired'
              : `🚗 Driver Licence Expiring — ${daysLeft} days`;
            const { notifications: notificationTable } = await import('@/db/schema/notifications');
            const [alreadySent] = await db
              .select({ id: notificationTable.id })
              .from(notificationTable)
              .where(
                and(
                  eq(notificationTable.tenantId, l.tenantId),
                  eq(notificationTable.recipientUserId, l.userId),
                  eq(notificationTable.entityId, l.licenceId),
                  eq(notificationTable.title, reminderTitle),
                ),
              )
              .limit(1);
            if (alreadySent) continue;

            await createScopedNotifications({
              tenantId: l.tenantId,
              recipientUserIds: [l.userId],
              category: 'reminder',
              eventType: 'driver_licence_expiring',
              title: reminderTitle,
              body: `${l.firstName} ${l.lastName} — ${l.licenceClass} licence expires${daysLeft > 0 ? ` in ${daysLeft} day(s)` : ' today'}.`,
              entityType: 'driver_licence',
              entityId: l.licenceId,
              actionUrl: `/dashboard/drivers/${l.employeeId}`,
              workspace: WorkspaceIds.DRIVER,
              eventVersion: reminderDay,
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
// Expiry Alert Cron: Driver Licence — Transport Admin Daily Digest
// ---------------------------------------------------------------------------
//
// Distinct from driverLicenceExpiryAlert (which pings each driver directly on
// their own threshold days). This cron sends ONE tenant-scoped digest per day
// to every Transport Administrator summarising all driver licences that expire
// within the next 60 days (or are already expired) — idempotent per tenant per
// day via a day-epoch eventVersion key.
// ---------------------------------------------------------------------------

export const driverLicenceExpiryDigest = inngest
  ? inngest.createFunction(
      { id: 'driver-licence-expiry-digest', retries: 2 },
      { cron: '0 8 * * *' }, // Daily at 08:00
      async ({ step }) => {
        return step.run('Send daily driver licence digest to transport admins', async () => {
          const db = getDb();
          const { driverProfiles, driverLicences, employees } = await import('@/db/schema/people');
          const { tenants } = await import('@/db/schema/tenants');
          const { user } = await import('@/db/schema/better-auth');
          const { notifications } = await import('@/db/schema/notifications');
          const { and, eq, gte, inArray, lte, ne } = await import('drizzle-orm');
          const { isBusinessDay } = await import('@/lib/business-day');

          const today = new Date();
          const sixtyDays = new Date();
          sixtyDays.setDate(sixtyDays.getDate() + 60);
          const horizon = sixtyDays.toISOString().split('T')[0];

          // Day-epoch key used for idempotency — one digest per tenant per day.
          const dayEpoch = Math.floor(today.getTime() / 86_400_000);

          const [emailModule] = await Promise.all([import('@/lib/email')]);
          const sendEmail = emailModule.sendNotificationEmail;

          const allTenants = await db
            .select({ id: tenants.id })
            .from(tenants)
            .catch(() => []);

          if (allTenants.length === 0) {
            return { skipped: true, reason: 'No tenants found' };
          }

          let tenantCount = 0;
          let emailedCount = 0;

          for (const tenant of allTenants) {
            // Skip non-business days for this tenant.
            if (!(await isBusinessDay(tenant.id, today))) continue;

            // Idempotency: a digest for this tenant was already sent today.
            const [alreadySent] = await db
              .select({ id: notifications.id })
              .from(notifications)
              .where(
                and(
                  eq(notifications.tenantId, tenant.id),
                  eq(notifications.eventType, 'driver_licence_expiry_digest'),
                  eq(notifications.eventVersion, dayEpoch),
                ),
              )
              .limit(1);
            if (alreadySent) continue;

            // Drivers with a licence expiring within 60 days (or already expired),
            // excluding archived employees.
            const expiring = await db
              .select({
                licenceId: driverLicences.id,
                licenceNumber: driverLicences.licenceNumber,
                licenceClass: driverLicences.licenceClass,
                expiryDate: driverLicences.expiryDate,
                firstName: employees.firstName,
                lastName: employees.lastName,
                email: employees.email,
              })
              .from(driverLicences)
              .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
              .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
              .where(
                and(
                  eq(employees.tenantId, tenant.id),
                  ne(employees.employmentStatus, 'archived'),
                  gte(driverLicences.expiryDate, today.toISOString().split('T')[0]),
                  lte(driverLicences.expiryDate, horizon),
                ),
              );

            if (expiring.length === 0) continue;

            const recipients = await resolveActiveRoleRecipients(tenant.id, [
              SystemRoles.TRANSPORT_ADMIN,
            ]);
            if (recipients.length === 0) continue;

            const hasUrgent = expiring.some((licence) => {
              const daysLeft = Math.ceil(
                (new Date(licence.expiryDate).getTime() - today.getTime()) / 86_400_000,
              );
              return daysLeft <= 7;
            });

            const lines = expiring
              .map((licence) => {
                const daysLeft = Math.ceil(
                  (new Date(licence.expiryDate).getTime() - today.getTime()) / 86_400_000,
                );
                const when =
                  daysLeft === 0
                    ? 'expires today'
                    : `expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
                return `• ${licence.firstName} ${licence.lastName} — ${licence.licenceClass} (${licence.licenceNumber ?? 'no number'}) ${when} (${licence.expiryDate})`;
              })
              .join('\n');

            await createScopedNotifications({
              tenantId: tenant.id,
              recipientUserIds: recipients,
              category: 'reminder',
              eventType: 'driver_licence_expiry_digest',
              title: `🚗 Driver Licence Digest — ${expiring.length} expiring`,
              body: `${expiring.length} driver licence(s) expire within 60 days:\n\n${lines}`,
              entityType: 'driver_licence',
              actionUrl: '/dashboard/drivers',
              workspace: WorkspaceIds.TRANSPORT_ADMIN,
              eventVersion: dayEpoch,
              priority: hasUrgent ? 'high' : 'normal',
            });
            tenantCount += 1;

            // Email each Transport Administrator with the same digest body.
            const adminUsers = await db
              .select({ id: user.id, email: user.email, name: user.name })
              .from(user)
              .where(inArray(user.id, recipients));

            for (const admin of adminUsers) {
              if (!admin.email) continue;
              try {
                await sendEmail({
                  to: admin.email,
                  type: 'reminder',
                  title: `Driver Licence Expiry Digest — ${expiring.length} licence(s)`,
                  body: `${expiring.length} driver licence(s) expire within 60 days:\n\n${lines}\n\nReview the driver roster for details.`,
                  actionUrl: '/dashboard/drivers',
                  recipientName: admin.name || 'Transport Administrator',
                });
                emailedCount += 1;
              } catch (emailErr) {
                console.warn(
                  `[driverLicenceExpiryDigest] Email to ${admin.email} failed:`,
                  emailErr,
                );
              }
            }
          }

          return {
            sent: tenantCount > 0,
            tenantCount,
            emailedCount,
          };
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

            const recipients = await resolveActiveRoleRecipients(m.tenantId, [
              SystemRoles.MAINTENANCE,
            ]);
            await createScopedNotifications({
              tenantId: m.tenantId,
              recipientUserIds: recipients,
              category: 'reminder',
              eventType: 'scheduled_maintenance_due',
              title: '🔧 Scheduled Maintenance Due',
              body: `${m.licenceNumber} — ${m.description} due on ${m.serviceDate || 'soon'}.`,
              entityType: 'maintenance_event',
              entityId: m.eventId,
              actionUrl: `/dashboard/fleet/${m.vehicleId}`,
              workspace: WorkspaceIds.MAINTENANCE,
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

            const daysRemaining = Math.ceil(
              (expiresAt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
            );
            const isExpired = daysRemaining <= 0;
            const label = doc.documentType
              .replace(/_/g, ' ')
              .replace(/\b\w/g, (c: string) => c.toUpperCase());

            const recipients = await resolveActiveRoleRecipients(doc.tenantId, [
              SystemRoles.AUDITOR,
            ]);
            await createScopedNotifications({
              tenantId: doc.tenantId,
              recipientUserIds: recipients,
              category: 'reminder',
              eventType: 'document_expiring',
              title: isExpired
                ? `📄 Document Expired: ${label}`
                : `📄 Document Expiring: ${label} (${daysRemaining} days)`,
              body: `${label} v${doc.documentVersion} ${isExpired ? `expired on ${expiresAt.toISOString().split('T')[0]}` : `will expire on ${expiresAt.toISOString().split('T')[0]} (${daysRemaining} days remaining)`}.`,
              entityType: doc.entityType,
              entityId: doc.entityId,
              actionUrl: `/dashboard/documents/${doc.docId}`,
              workspace: WorkspaceIds.AUDIT,
              priority: daysRemaining <= 7 ? 'high' : 'normal',
            });
          }

          return { sent: true, count: expiringDocs.length };
        });
      },
    )
  : null;

// ---------------------------------------------------------------------------
// Trip Return Due Check Cron
// ---------------------------------------------------------------------------

export const tripReturnDueCheck = inngest
  ? inngest.createFunction(
      { id: 'trip-return-due-check', retries: 2 },
      { cron: '0 8 * * *' }, // Daily at 08:00
      async ({ step }) => {
        return step.run('Check for overdue trips across all tenants', async () => {
          const db = getDb();
          const { tenants: tenantsTable } = await import('@/db/schema/tenants');
          const { trips, vehicleAllocations } = await import('@/db/schema/trips');
          const { vehicles, vehicleStatusEvents } = await import('@/db/schema/fleet');
          const { auditEvents } = await import('@/db/schema/audit');
          const { notifications } = await import('@/db/schema/notifications');
          const { eq, and, lt, sql: drizzleSql } = await import('drizzle-orm');
          const { isBusinessDay } = await import('@/lib/business-day');

          const today = new Date();
          const bdCache = new Map<string, boolean>();

          // Get all active tenants
          const allTenants = await db
            .select({ id: tenantsTable.id })
            .from(tenantsTable)
            .catch(() => []);

          if (allTenants.length === 0) {
            return { skipped: true, reason: 'No tenants found' };
          }

          let totalOverdue = 0;
          let totalNotifications = 0;

          // Get email module for sending notifications
          const [emailModule] = await Promise.all([import('@/lib/email')]);
          const sendEmail = emailModule.sendNotificationEmail;

          for (const tenant of allTenants) {
            // Check business day once per tenant
            if (!bdCache.has(tenant.id)) {
              bdCache.set(tenant.id, await isBusinessDay(tenant.id, today));
            }
            if (!bdCache.get(tenant.id)) continue;

            // Find in_progress trips past their allocation end time
            const overdueTrips = await db
              .select({
                id: trips.id,
                vehicleId: trips.vehicleId,
                requestId: trips.requestId,
                endAt: vehicleAllocations.endAt,
                make: vehicles.make,
                model: vehicles.model,
                licenceNumber: vehicles.licenceNumber,
              })
              .from(trips)
              .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
              .innerJoin(vehicles, eq(trips.vehicleId, vehicles.id))
              .where(
                and(
                  eq(trips.tenantId, tenant.id),
                  eq(trips.status, 'in_progress'),
                  lt(vehicleAllocations.endAt, today),
                ),
              );

            if (overdueTrips.length === 0) continue;

            // Update to return_due
            const overdueIds = overdueTrips.map((t) => t.id);
            await db
              .update(trips)
              .set({ status: 'return_due', updatedAt: today })
              .where(
                and(
                  eq(trips.tenantId, tenant.id),
                  eq(trips.status, 'in_progress'),
                  drizzleSql`${trips.id} = ANY(${overdueIds}::uuid[])`,
                ),
              );

            // Fetch requester emails for each overdue trip
            const requestIds = overdueTrips.map((t) => t.requestId).filter(Boolean);
            let requesterEmails: Array<{
              requestId: string;
              email: string | null;
              name: string | null;
            }> = [];
            if (requestIds.length > 0) {
              const { transportRequests } = await import('@/db/schema/requests');
              const { employees } = await import('@/db/schema/people');
              const { inArray } = await import('drizzle-orm');
              requesterEmails = await db
                .select({
                  requestId: transportRequests.id,
                  email: employees.email,
                  name: employees.firstName,
                })
                .from(transportRequests)
                .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
                .where(
                  and(
                    eq(transportRequests.tenantId, tenant.id),
                    inArray(transportRequests.id, requestIds),
                  ),
                );
            }

            totalOverdue += overdueTrips.length;

            for (const trip of overdueTrips) {
              const requester = requesterEmails.find((r) => r.requestId === trip.requestId);
              // Audit log
              await db.insert(auditEvents).values({
                tenantId: tenant.id,
                tenantSequence: 0,
                eventType: 'trip_return_due',
                actorUserId: '00000000-0000-0000-0000-000000000000',
                action: 'system_flag',
                entityType: 'trip',
                entityId: trip.id,
                summary: `Trip flagged return_due: ${trip.make} ${trip.model} (${trip.licenceNumber}) — allocation ended at ${trip.endAt?.toISOString()}`,
                sourceChannel: 'system',
              });

              // Vehicle status event
              await db.insert(vehicleStatusEvents).values({
                vehicleId: trip.vehicleId,
                previousStatus: 'allocated',
                newStatus: 'return_due',
                reason: 'Allocation period ended. Trip flagged as return_due by daily cron.',
                changedByUserId: '00000000-0000-0000-0000-000000000000',
                referenceEntityType: 'trip',
                referenceEntityId: trip.id,
              });

              // Create notification
              const recipients = await resolveActiveRoleRecipients(tenant.id, [
                SystemRoles.TRANSPORT_ADMIN,
              ]);
              const created = await createScopedNotifications({
                tenantId: tenant.id,
                recipientUserIds: recipients,
                category: 'escalation',
                eventType: 'trip_return_overdue',
                title: '⚠️ Trip Return Overdue',
                body: `${trip.make} ${trip.model} (${trip.licenceNumber}) — return was due. Please arrange return and inspection.`,
                entityType: 'trip',
                entityId: trip.id,
                actionUrl: `/dashboard/trips/${trip.id}`,
                workspace: WorkspaceIds.TRANSPORT_ADMIN,
                priority: 'high',
              });
              totalNotifications += created.length;

              // Send email notification if we have the requester's address
              if (requester?.email && sendEmail) {
                try {
                  await sendEmail({
                    to: requester.email,
                    type: 'trip_returned',
                    title: '⚠️ Trip Return Overdue',
                    body: `${trip.make} ${trip.model} (${trip.licenceNumber}) — this trip's return was due at ${trip.endAt ? new Date(trip.endAt).toLocaleDateString() : 'the scheduled time'}. Please arrange the vehicle return and post-trip inspection immediately.`,
                    actionUrl: `/dashboard/trips/${trip.id}`,
                    recipientName: requester.name || 'Fleet Manager',
                  });
                } catch (emailErr) {
                  console.warn(
                    `[tripReturnDueCheck] Email to ${requester.email} failed:`,
                    emailErr,
                  );
                }
              }
            }
          }

          return {
            sent: totalOverdue > 0,
            overdueCount: totalOverdue,
            notificationCount: totalNotifications,
          };
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
    driverLicenceExpiryDigest,
    maintenanceReminder,
    documentExpiryAlert,
    tripReturnDueCheck,
  ] as const
).filter((f): f is NonNullable<typeof f> => f !== null);
