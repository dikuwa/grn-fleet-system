import { and, count, eq, inArray } from 'drizzle-orm';
import { getDb } from '@/db';
import {
  departments,
  offices,
  roleAssignments,
  roles,
  tenantMemberships,
  tenants,
  tenantSetupProgress,
  tenantSubscriptions,
  workflowDefinitions,
  workflowSteps,
} from '@/db/schema';
import { RoleDefinitions } from '@/lib/permissions';

export type ReadinessSeverity = 'blocker' | 'warning';

export interface TenantReadinessCheck {
  id: string;
  label: string;
  description: string;
  severity: ReadinessSeverity;
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

  const [
    [tenant],
    [setup],
    [officeTotal],
    [departmentTotal],
    [subscriptionTotal],
    [tenantAdminTotal],
    activeWorkflows,
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
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, tenantId)),
    db
      .select({ total: count() })
      .from(tenantMemberships)
      .innerJoin(roleAssignments, eq(roleAssignments.tenantMembershipId, tenantMemberships.id))
      .innerJoin(roles, eq(roles.id, roleAssignments.roleId))
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          eq(tenantMemberships.status, 'active'),
          eq(roles.name, RoleDefinitions.TENANT_ADMIN.name),
        ),
      ),
    db
      .select({ id: workflowDefinitions.id, name: workflowDefinitions.name })
      .from(workflowDefinitions)
      .where(and(eq(workflowDefinitions.tenantId, tenantId), eq(workflowDefinitions.isActive, true))),
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

  const checks: TenantReadinessCheck[] = [
    {
      id: 'workspace-setup',
      label: 'Workspace setup submitted',
      description: 'Tenant Administrator must complete Organisation, Offices and initial configuration, then submit the workspace for platform review.',
      severity: 'blocker',
      ready: setup?.isReady === true,
    },
    {
      id: 'tenant-admin',
      label: 'Tenant Administrator has access',
      description: 'At least one active Tenant Administrator account is required to manage the organisation after activation.',
      severity: 'blocker',
      ready: Number(tenantAdminTotal?.total ?? 0) > 0,
      actionHref: `/dashboard/platform/tenants/${tenantId}/invitation`,
      actionLabel: 'Manage invitation',
    },
    {
      id: 'office',
      label: 'Operational office or depot',
      description: 'Tenant Administrator must configure at least one active office, depot or operational location.',
      severity: 'blocker',
      ready: Number(officeTotal?.total ?? 0) > 0,
    },
    {
      id: 'workflow',
      label: 'Approval workflow configured',
      description: 'Tenant Administrator must configure at least one active transport-request workflow with approval steps before real requests can be processed.',
      severity: 'blocker',
      ready: activeWorkflowWithSteps,
    },
    {
      id: 'subscription',
      label: 'Subscription package assigned',
      description: 'The tenant must be attached to a package so entitlements and limits can be enforced consistently.',
      severity: 'blocker',
      ready: Number(subscriptionTotal?.total ?? 0) > 0,
    },
    {
      id: 'departments',
      label: 'Departments or organisational units',
      description: 'Recommended for routing, reporting and staff organisation, but not required for every tenant type.',
      severity: 'warning',
      ready: Number(departmentTotal?.total ?? 0) > 0,
    },
  ];

  const blockerCount = checks.filter((check) => check.severity === 'blocker' && !check.ready).length;
  const warningCount = checks.filter((check) => check.severity === 'warning' && !check.ready).length;

  return {
    tenantId,
    readyForActivation: blockerCount === 0,
    blockerCount,
    warningCount,
    checks,
  };
}
