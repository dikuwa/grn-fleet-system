import Link from 'next/link';
import { and, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  Bell,
  Building2,
  ClipboardCheck,
  FileText,
  Fuel,
  Shield,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';
import { fuelTransactions } from '@/db/schema';
import { getDb, isDbConnected } from '@/db';
import {
  employees,
  notifications,
  notificationDeliveries,
  roleAssignments,
  tenantMemberships,
  tenants,
  transportRequests,
  trips,
  vehicleAllocations,
  vehicleDefects,
  vehicleInspections,
  vehicles,
  workflowInstances,
  workflowSteps,
} from '@/db/schema';
import { getServerSession } from '@/lib/session';
import { getSessionWorkspace } from '@/lib/auth-helpers';
import { getWorkspaceNavigation } from '@/lib/dashboard-access';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { WorkspaceIds, type WorkspaceId } from '@/lib/workspaces';

type Metric = { label: string; value: number; href?: string; icon: React.ReactNode };

async function countRows(query: Promise<Array<{ count: number }>>) {
  const rows = await query;
  return Number(rows[0]?.count || 0);
}

async function getWorkspaceMetrics(
  tenantId: string,
  userId: string,
  workspace: WorkspaceId,
): Promise<Metric[]> {
  const db = getDb();
  const count = sql<number>`count(*)`;

  if (workspace === WorkspaceIds.PLATFORM_ADMIN) {
    return [
      {
        label: 'Active tenants',
        value: await countRows(
          db
            .select({ count })
            .from(tenants)
            .where(sql`lower(${tenants.status}) = 'active'`),
        ),
        href: '/dashboard/platform/tenants',
        icon: <Building2 className="h-5 w-5" />,
      },
    ];
  }

  if (workspace === WorkspaceIds.TENANT_ADMIN) {
    return [
      {
        label: 'Active employees',
        value: await countRows(
          db
            .select({ count })
            .from(employees)
            .where(and(eq(employees.tenantId, tenantId), eq(employees.employmentStatus, 'active'))),
        ),
        href: '/dashboard/staff',
        icon: <Users className="h-5 w-5" />,
      },
      {
        label: 'Suspended users',
        value: await countRows(
          db
            .select({ count })
            .from(tenantMemberships)
            .where(
              and(
                eq(tenantMemberships.tenantId, tenantId),
                eq(tenantMemberships.status, 'suspended'),
              ),
            ),
        ),
        href: '/dashboard/admin/users',
        icon: <Shield className="h-5 w-5" />,
      },
      {
        label: 'Active acting roles',
        value: await countRows(
          db
            .select({ count })
            .from(roleAssignments)
            .innerJoin(
              tenantMemberships,
              eq(roleAssignments.tenantMembershipId, tenantMemberships.id),
            )
            .where(
              and(
                eq(tenantMemberships.tenantId, tenantId),
                eq(roleAssignments.isActing, true),
                or(isNull(roleAssignments.endDate), sql`${roleAssignments.endDate} >= now()`),
              ),
            ),
        ),
        href: '/dashboard/delegations',
        icon: <Users className="h-5 w-5" />,
      },
      {
        label: 'Failed deliveries',
        value: await countRows(
          db
            .select({ count })
            .from(notificationDeliveries)
            .innerJoin(notifications, eq(notificationDeliveries.notificationId, notifications.id))
            .where(
              and(
                eq(notifications.tenantId, tenantId),
                eq(notificationDeliveries.status, 'failed'),
              ),
            ),
        ),
        href: '/dashboard/notifications/deliveries',
        icon: <Bell className="h-5 w-5" />,
      },
    ];
  }

  if (workspace === WorkspaceIds.PERSONAL) {
    return [
      {
        label: 'Requires my attention',
        value: await countRows(
          db
            .select({ count })
            .from(transportRequests)
            .where(
              and(
                eq(transportRequests.tenantId, tenantId),
                eq(transportRequests.requesterUserId, userId),
                eq(transportRequests.status, 'returned'),
              ),
            ),
        ),
        href: '/dashboard/requests?status=returned',
        icon: <FileText className="h-5 w-5" />,
      },
      {
        label: 'My pending requests',
        value: await countRows(
          db
            .select({ count })
            .from(transportRequests)
            .where(
              and(
                eq(transportRequests.tenantId, tenantId),
                eq(transportRequests.requesterUserId, userId),
                sql`${transportRequests.status} in ('submitted','pending_supervisor','pending_transport','pending_release','pending_authorisation')`,
              ),
            ),
        ),
        href: '/dashboard/requests',
        icon: <FileText className="h-5 w-5" />,
      },
      {
        label: 'My approved requests',
        value: await countRows(
          db
            .select({ count })
            .from(transportRequests)
            .where(
              and(
                eq(transportRequests.tenantId, tenantId),
                eq(transportRequests.requesterUserId, userId),
                sql`${transportRequests.status} in ('approved','authorised','ready_for_issue')`,
              ),
            ),
        ),
        href: '/dashboard/requests',
        icon: <Truck className="h-5 w-5" />,
      },
      {
        label: 'My drafts',
        value: await countRows(
          db
            .select({ count })
            .from(transportRequests)
            .where(
              and(
                eq(transportRequests.tenantId, tenantId),
                eq(transportRequests.requesterUserId, userId),
                eq(transportRequests.status, 'draft'),
              ),
            ),
        ),
        href: '/dashboard/requests?status=draft',
        icon: <FileText className="h-5 w-5" />,
      },
    ];
  }

  if (workspace === WorkspaceIds.DRIVER) {
    const driverBase = (
      condition: SQL<boolean> | undefined,
    ) =>
      db
        .select({ count })
        .from(trips)
        .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .innerJoin(employees, eq(vehicleAllocations.driverEmployeeId, employees.id))
        .where(
          and(
            eq(trips.tenantId, tenantId),
            eq(employees.userId, userId),
            condition ?? sql<boolean>`true`,
          ),
        );
    return [
      {
        label: 'My active trips',
        value: await countRows(driverBase(sql<boolean>`${trips.status} != 'closed'`)),
        href: '/dashboard/trips',
        icon: <Truck className="h-5 w-5" />,
      },
      {
        label: 'Trips due for return',
        value: await countRows(
          driverBase(sql<boolean>`${trips.status} in ('return_due','in_progress')`),
        ),
        href: '/dashboard/trips?status=return_due',
        icon: <FileText className="h-5 w-5" />,
      },
      {
        label: 'My fuel records (30d)',
        value: await countRows(
          db
            .select({ count })
            .from(fuelTransactions)
            .innerJoin(trips, eq(fuelTransactions.tripId, trips.id))
            .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
            .innerJoin(employees, eq(vehicleAllocations.driverEmployeeId, employees.id))
            .where(
              and(
                eq(trips.tenantId, tenantId),
                eq(employees.userId, userId),
                sql`${fuelTransactions.transactionAt} >= now() - interval '30 days'`,
              ),
            ),
        ),
        href: '/dashboard/fuel',
        icon: <Fuel className="h-5 w-5" />,
      },
    ];
  }

  if (workspace === WorkspaceIds.INSPECTOR) {
    return [
      {
        label: 'My inspections',
        value: await countRows(
          db
            .select({ count })
            .from(vehicleInspections)
            .where(
              and(
                eq(vehicleInspections.tenantId, tenantId),
                eq(vehicleInspections.inspectorUserId, userId),
              ),
            ),
        ),
        href: '/dashboard/inspections',
        icon: <ClipboardCheck className="h-5 w-5" />,
      },
    ];
  }

  if (workspace === WorkspaceIds.MAINTENANCE) {
    return [
      {
        label: 'My unresolved defects',
        value: await countRows(
          db
            .select({ count })
            .from(vehicleDefects)
            .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
            .where(
              and(
                eq(vehicles.tenantId, tenantId),
                isNull(vehicleDefects.resolvedAt),
                or(
                  eq(vehicleDefects.reportedByUserId, userId),
                  eq(vehicleDefects.assignedToUserId, userId),
                  eq(vehicleDefects.resolvedByUserId, userId),
                ),
              ),
            ),
        ),
        href: '/dashboard/fleet/defects',
        icon: <Wrench className="h-5 w-5" />,
      },
    ];
  }

  if (workspace === WorkspaceIds.TRANSPORT_ADMIN) {
    return [
      {
        label: 'Active requests',
        value: await countRows(
          db
            .select({ count })
            .from(transportRequests)
            .where(
              and(eq(transportRequests.tenantId, tenantId), ne(transportRequests.status, 'closed')),
            ),
        ),
        href: '/dashboard/requests',
        icon: <FileText className="h-5 w-5" />,
      },
      {
        label: 'Active trips',
        value: await countRows(
          db
            .select({ count })
            .from(trips)
            .where(and(eq(trips.tenantId, tenantId), ne(trips.status, 'closed'))),
        ),
        href: '/dashboard/trips',
        icon: <Truck className="h-5 w-5" />,
      },
      {
        label: 'Open defects',
        value: await countRows(
          db
            .select({ count })
            .from(vehicleDefects)
            .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
            .where(and(eq(vehicles.tenantId, tenantId), isNull(vehicleDefects.resolvedAt))),
        ),
        href: '/dashboard/fleet/defects',
        icon: <Wrench className="h-5 w-5" />,
      },
    ];
  }

  if (workspace === WorkspaceIds.AUDIT) {
    return [
      {
        label: 'Unresolved compliance findings',
        value: await countRows(
          db
            .select({ count })
            .from(vehicleDefects)
            .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
            .where(and(eq(vehicles.tenantId, tenantId), isNull(vehicleDefects.resolvedAt))),
        ),
        href: '/dashboard/fleet/defects',
        icon: <Shield className="h-5 w-5" />,
      },
    ];
  }

  // Approval workspace only counts work currently assigned to this person.
  return [
    {
      label: 'Assigned approvals',
      value: await countRows(
        db
          .select({ count })
          .from(workflowInstances)
          .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
          .leftJoin(
            workflowSteps,
            and(
              eq(workflowSteps.definitionId, workflowInstances.definitionId),
              eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder),
            ),
          )
          .where(
            and(
              eq(transportRequests.tenantId, tenantId),
              eq(workflowInstances.status, 'active'),
              eq(workflowSteps.assignedUserId, userId),
            ),
          ),
      ),
      href: '/dashboard/approvals',
      icon: <Shield className="h-5 w-5" />,
    },
  ];
}

async function getUnreadNotificationCount(
  tenantId: string,
  userId: string,
  workspace: WorkspaceId,
) {
  const db = getDb();
  return countRows(
    db
      .select({ count: sql<number>`count(*)` })
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.recipientUserId, userId),
          eq(notifications.isRead, false),
          ne(notifications.status, 'archived'),
          ne(notifications.status, 'dismissed'),
          or(isNull(notifications.workspace), eq(notifications.workspace, workspace)),
        ),
      ),
  );
}

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session || !isDbConnected()) {
    return (
      <EmptyState
        icon={<Shield className="h-6 w-6" />}
        title="Dashboard unavailable"
        description="Sign in with an active tenant account."
      />
    );
  }

  const workspaceContext = await getSessionWorkspace(session);
  const metrics = await getWorkspaceMetrics(
    session.tenantId,
    session.user.id,
    workspaceContext.activeWorkspace,
  );
  const unreadActivity = await getUnreadNotificationCount(
    session.tenantId,
    session.user.id,
    workspaceContext.activeWorkspace,
  );
  const workspaceLabel =
    workspaceContext.eligibleWorkspaces.find(
      (workspace) => workspace.id === workspaceContext.activeWorkspace,
    )?.label ?? 'Personal Requester';
  const links = getWorkspaceNavigation(workspaceContext.activeWorkspace)
    .filter((route) => !['dashboard', 'profile', 'notifications'].includes(route.id))
    .slice(0, 9)
    .map((route) => [route.href, route.label] as const);

  return (
    <div className="space-y-6">
      <PageHeader title={workspaceLabel} description="Your current responsibility workspace" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <Bell className="text-brand-700 h-5 w-5" />
            <p className="text-ink-950 mt-3 text-2xl font-semibold tabular-nums">
              {unreadActivity}
            </p>
            <p className="text-ink-500 text-xs">Unread relevant notifications</p>
            <Link
              className="text-brand-700 mt-3 inline-block text-xs font-medium"
              href="/dashboard/notifications"
            >
              View notifications
            </Link>
          </CardContent>
        </Card>
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className="pt-5">
              <span className="text-brand-700">{metric.icon}</span>
              <p className="text-ink-950 mt-3 text-2xl font-semibold tabular-nums">
                {metric.value}
              </p>
              <p className="text-ink-500 text-xs">{metric.label}</p>
              {metric.href && (
                <Link
                  className="text-brand-700 mt-3 inline-block text-xs font-medium"
                  href={metric.href}
                >
                  Open workspace
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {links.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <h2 className="text-ink-950 text-sm font-semibold">Workspace shortcuts</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {links.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="border-border text-ink-700 hover:border-brand-200 hover:bg-brand-50/40 rounded-[8px] border px-4 py-3 text-sm transition-colors"
                >
                  {label}
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
