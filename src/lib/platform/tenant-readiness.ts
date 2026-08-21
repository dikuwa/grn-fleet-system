import { and, count, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  departments,
  offices,
  roleAssignments,
  roles,
  tenantMemberships,
  tenants,
  tenantSetupProgress,
  workflowDefinitions,
  workflowSteps,
} from '@/db/schema';
import { inspectionTemplates } from '@/db/schema/trips';
import {
  getTenantEntitlements,
  type SubscriptionStatusType,
} from '@/lib/entitlements';
import { SystemRoles } from '@/lib/workspaces';

export type ReadinessSeverity = 'blocker' | 'warning';
export type ReadinessOwner = 'platform' | 'tenant';

export interface TenantReadinessCheck {
  id: string;
  label: string;
  description: string;
  severity: ReadinessSeverity;
  owner: ReadinessOwner;
  ready: boolean;
  actionHref?: string;
  actionLabel?: string;
}

export interface TenantOperationalReadiness {
  tenantId: string;
  readyForActivation: boolean;
  blockerCount: number;
  warningCount: number;
  checks: TenantReadinessCheck[];
}

export function isActivationSubscriptionReady(status: SubscriptionStatusType): boolean {
  return status === 'TRIALING' || status === 'ACTIVE' || status === 'GRACE_PERIOD';
}

export function hasRequiredInspectionTemplates(types: Iterable<string>): boolean {
  const activeTypes = new Set(types);
  return activeTypes.has('departure') && activeTypes.has('return');
}

function subscriptionStatusLabel(status: SubscriptionStatusType) {
  return status.replaceAll('_', ' ').toLowerCase();
}

/**
 * Operational activation readiness deliberately checks only universal tenant
 * prerequisites. Tenant-specific choices such as BlueFuel, regions, public
 * employee request access, fleet size and driver population remain optional
 * configuration and must not block activation.
 */
export async function assessTenantOperationalReadiness(
  tenantId: string,
): Promise<TenantOperationalReadiness> {
  const db = getDb();
  const now = new Date();

  const [
    [tenant],
    [setup],
    [officeTotal],
    [departmentTotal],
    [tenantAdminTotal],
    activeWorkflows,
    activeInspectionTemplates,
    entitlements,
  ] = await Promise.all([
    db
      .select({ id: tenants.id, lifecycleStatus: tenants.lifecycleStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1),
    db
      .select({ isReady: tenantSetupProgress.isReady })
      .from(tenantSetupProgress)
      .where(eq(tenantSetupProgress.tenantId, tenantId))
      .limit(1),
    db
      .select({ total: count() })
      .from(offices)
      .where(and(eq(offices.tenantId, tenantId), eq(offices.isActive, true))),
    db
      .select({ total: count() })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.isActive, true))),
    db
      .select({ total: count() })
      .from(tenantMemberships)
      .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(roles.name, SystemRoles.TENANT_ADMIN),
          lte(roleAssignments.startDate, now),
          or(isNull(roleAssignments.endDate), gt(roleAssignments.endDate, now)),
        ),
      ),
    db
      .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.isActive, true))),
    db
      .select({ type: inspectionTemplates.type })
      .from(inspectionTemplates)
      .where(
        and(
          eq(inspectionTemplates.tenantId, tenantId),
          eq(inspectionTemplates.isActive, true),
        ),
      ),
    getTenantEntitlements(tenantId),
  ]);

  if (!tenant) throw new Error('Tenant not found');

  let activeWorkflowWithSteps = false;
  if (activeWorkflows.length > 0) {
    const [stepTotal] = await db
      .select({ total: count() })
      .from(workflowSteps)
      .where(inArray(workflowSteps.definitionId, activeWorkflows.map((workflow) => workflow.id)));
    activeWorkflowWithSteps = Number(stepTotal?.total ?? 0) > 0;
  }

  const inspectionTemplatesReady = hasRequiredInspectionTemplates(
    activeInspectionTemplates.map((template) => template.type),
  );

  const subscriptionStatus = entitlements?.subscriptionStatus ?? 'NOT_CONFIGURED';
  const subscriptionReady = isActivationSubscriptionReady(subscriptionStatus);
  const subscriptionDescription = subscriptionReady
    ? `${entitlements?.packageName ?? 'Subscription package'} is ${subscriptionStatusLabel(subscriptionStatus)} and usable for tenant operation.`
    : `Platform Administration must assign or restore a usable subscription before activation. Current status: ${subscriptionStatusLabel(subscriptionStatus)}.`;

  const checks: TenantReadinessCheck[] = [
    {
      id: 'workspace-setup',
      label: 'Initial workspace setup complete',
      description:
        'Tenant Administrator must confirm the organisation and at least one operating location before operational setup can be submitted.',
      severity: 'blocker',
      owner: 'tenant',
      ready: setup?.isReady === true,
    },
    {
      id: 'tenant-admin',
      label: 'Tenant Administrator has access',
      description:
        'At least one active Tenant Administrator account is required to manage the organisation after activation.',
      severity: 'blocker',
      owner: 'platform',
      ready: Number(tenantAdminTotal?.total ?? 0) > 0,
      actionHref: `/dashboard/platform/tenants/${tenantId}/invitation`,
      actionLabel: 'Manage invitation',
    },
    {
      id: 'office',
      label: 'Operational office or depot',
      description:
        'Tenant Administrator must configure at least one active office, depot or operating location.',
      severity: 'blocker',
      owner: 'tenant',
      ready: Number(officeTotal?.total ?? 0) > 0,
    },
    {
      id: 'workflow',
      label: 'Approval workflow configured',
      description:
        'Tenant Administrator must configure at least one active transport-request workflow with approval steps before real requests can be processed.',
      severity: 'blocker',
      owner: 'tenant',
      ready: activeWorkflowWithSteps,
    },
    {
      id: 'inspection-templates',
      label: 'Departure and return inspection checklists',
      description:
        'Both active inspection checklists are required so vehicles cannot be issued or returned outside the governed inspection process.',
      severity: 'blocker',
      owner: 'tenant',
      ready: inspectionTemplatesReady,
    },
    {
      id: 'subscription',
      label: 'Usable subscription',
      description: subscriptionDescription,
      severity: 'blocker',
      owner: 'platform',
      ready: subscriptionReady,
      actionHref: '/dashboard/platform/subscriptions',
      actionLabel: 'Manage subscriptions',
    },
    {
      id: 'departments',
      label: 'Departments or organisational units',
      description:
        'Recommended for routing, reporting and staff organisation, but not required for every tenant type.',
      severity: 'warning',
      owner: 'tenant',
      ready: Number(departmentTotal?.total ?? 0) > 0,
    },
  ];

  const blockerCount = checks.filter(
    (check) => check.severity === 'blocker' && !check.ready,
  ).length;
  const warningCount = checks.filter(
    (check) => check.severity === 'warning' && !check.ready,
  ).length;

  return {
    tenantId,
    readyForActivation: blockerCount === 0,
    blockerCount,
    warningCount,
    checks,
  };
}
