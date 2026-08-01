import Link from 'next/link';
import { and, eq, isNull, ne, or, sql } from 'drizzle-orm';
import {
  Bell,
  Building2,
  CheckSquare,
  ClipboardCheck,
  FileText,
  Route as RouteIcon,
  Shield,
  Truck,
  Users,
  Wrench,
} from 'lucide-react';
import { getDb, isDbConnected } from '@/db';
import {
  employees,
  maintenanceEvents,
  notifications,
  notificationReads,
  requestRoutes,
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
import { getSessionRoleNames } from '@/lib/auth-helpers';
import { canAccessDashboardPath, SystemRoles } from '@/lib/dashboard-access';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

type Metric = { label: string; value: number; href?: string; icon: React.ReactNode };

const quickLinks = [
  ['/dashboard/platform', 'Platform Dashboard'],
  ['/dashboard/staff', 'Staff Directory'],
  ['/dashboard/approvals', 'Assigned Approvals'],
  ['/dashboard/requests', 'Requests'],
  ['/dashboard/allocations', 'Allocations'],
  ['/dashboard/trips', 'Trips'],
  ['/dashboard/fleet', 'Fleet'],
  ['/dashboard/inspections', 'Inspections'],
  ['/dashboard/maintenance', 'Maintenance'],
  ['/dashboard/audit', 'Audit Log'],
  ['/dashboard/reports', 'Reports'],
] as const;

async function countRows(query: Promise<Array<{ count: number }>>) {
  const rows = await query;
  return Number(rows[0]?.count || 0);
}

/** Sum of mapped route kilometres across all request routes for a tenant. */
async function totalRouteKm(tenantId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ km: sql<number>`COALESCE(SUM(COALESCE(${requestRoutes.totalKilometres}, ${requestRoutes.mappedDistanceKm}, 0)), 0)` })
    .from(requestRoutes)
    .innerJoin(transportRequests, eq(requestRoutes.requestId, transportRequests.id))
    .where(eq(transportRequests.tenantId, tenantId));
  return Math.round(Number(rows[0]?.km || 0));
}

/** Sum of mapped route kilometres for the current user's own requests. */
async function myRouteKm(tenantId: string, userId: string): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ km: sql<number>`COALESCE(SUM(COALESCE(${requestRoutes.totalKilometres}, ${requestRoutes.mappedDistanceKm}, 0)), 0)` })
    .from(requestRoutes)
    .innerJoin(transportRequests, eq(requestRoutes.requestId, transportRequests.id))
    .where(and(eq(transportRequests.tenantId, tenantId), eq(transportRequests.requesterUserId, userId)));
  return Math.round(Number(rows[0]?.km || 0));
}

async function getRoleMetrics(tenantId: string, userId: string, roleNames: string[]): Promise<Metric[]> {
  const db = getDb();
  const has = (role: string) => roleNames.includes(role);
  const count = sql<number>`count(*)`;

  if (has(SystemRoles.PLATFORM_ADMIN)) {
    return [
      { label: 'Active tenants', value: await countRows(db.select({ count }).from(tenants).where(eq(tenants.status, 'active'))), href: '/dashboard/platform/tenants', icon: <Building2 className="h-5 w-5" /> },
    ];
  }

  if (has(SystemRoles.TENANT_ADMIN)) {
    return [
      { label: 'Active employees', value: await countRows(db.select({ count }).from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.employmentStatus, 'active')))), href: '/dashboard/staff', icon: <Users className="h-5 w-5" /> },
      { label: 'Fleet drivers', value: await countRows(db.select({ count }).from(employees).where(and(eq(employees.tenantId, tenantId), eq(employees.isDriver, true), eq(employees.employmentStatus, 'active')))), href: '/dashboard/drivers', icon: <Truck className="h-5 w-5" /> },
      { label: 'Route distance (km)', value: await totalRouteKm(tenantId), href: '/dashboard/reports', icon: <RouteIcon className="h-5 w-5" /> },
    ];
  }

  if (has(SystemRoles.REQUESTER)) {
    return [
      { label: 'My active requests', value: await countRows(db.select({ count }).from(transportRequests).where(and(eq(transportRequests.tenantId, tenantId), eq(transportRequests.requesterUserId, userId), ne(transportRequests.status, 'closed')))), href: '/dashboard/requests', icon: <FileText className="h-5 w-5" /> },
      { label: 'My route distance (km)', value: await myRouteKm(tenantId, userId), href: '/dashboard/requests', icon: <RouteIcon className="h-5 w-5" /> },
    ];
  }

  if (has(SystemRoles.DRIVER)) {
    return [
      { label: 'My active trips', value: await countRows(db.select({ count }).from(trips)
        .innerJoin(vehicleAllocations, eq(trips.allocationId, vehicleAllocations.id))
        .innerJoin(employees, eq(vehicleAllocations.driverEmployeeId, employees.id))
        .where(and(eq(trips.tenantId, tenantId), eq(employees.userId, userId), ne(trips.status, 'closed')))), href: '/dashboard/trips', icon: <Truck className="h-5 w-5" /> },
      { label: 'My inspections', value: await countRows(db.select({ count }).from(vehicleInspections).where(and(eq(vehicleInspections.tenantId, tenantId), eq(vehicleInspections.inspectorUserId, userId)))), href: '/dashboard/inspections', icon: <ClipboardCheck className="h-5 w-5" /> },
    ];
  }

  if (has(SystemRoles.INSPECTOR) || has(SystemRoles.RELEASE_OFFICER)) {
    return [
      { label: 'My inspections', value: await countRows(db.select({ count }).from(vehicleInspections).where(and(eq(vehicleInspections.tenantId, tenantId), eq(vehicleInspections.inspectorUserId, userId)))), href: '/dashboard/inspections', icon: <ClipboardCheck className="h-5 w-5" /> },
    ];
  }

  if (has(SystemRoles.MAINTENANCE)) {
    return [
      { label: 'Open defects', value: await countRows(db.select({ count }).from(vehicleDefects).innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id)).where(and(eq(vehicles.tenantId, tenantId), isNull(vehicleDefects.resolvedAt)))), href: '/dashboard/fleet/defects', icon: <Wrench className="h-5 w-5" /> },
      { label: 'Maintenance records', value: await countRows(db.select({ count }).from(maintenanceEvents).innerJoin(vehicles, eq(maintenanceEvents.vehicleId, vehicles.id)).where(eq(vehicles.tenantId, tenantId))), href: '/dashboard/maintenance', icon: <CheckSquare className="h-5 w-5" /> },
    ];
  }

  if (has(SystemRoles.TRANSPORT_ADMIN) || has(SystemRoles.AUDITOR)) {
    return [
      { label: 'Active requests', value: await countRows(db.select({ count }).from(transportRequests).where(and(eq(transportRequests.tenantId, tenantId), ne(transportRequests.status, 'closed')))), href: '/dashboard/requests', icon: <FileText className="h-5 w-5" /> },
      { label: 'Active trips', value: await countRows(db.select({ count }).from(trips).where(and(eq(trips.tenantId, tenantId), ne(trips.status, 'closed')))), href: '/dashboard/trips', icon: <Truck className="h-5 w-5" /> },
      { label: 'Route distance (km)', value: await totalRouteKm(tenantId), href: '/dashboard/reports', icon: <RouteIcon className="h-5 w-5" /> },
      { label: 'Open defects', value: await countRows(db.select({ count }).from(vehicleDefects).innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id)).where(and(eq(vehicles.tenantId, tenantId), isNull(vehicleDefects.resolvedAt)))), href: '/dashboard/fleet/defects', icon: <Wrench className="h-5 w-5" /> },
    ];
  }

  // Approval roles only see work currently assigned to them.
  return [
    { label: 'Assigned approvals', value: await countRows(db.select({ count }).from(workflowInstances)
      .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
      .leftJoin(workflowSteps, and(eq(workflowSteps.definitionId, workflowInstances.definitionId), eq(workflowSteps.stepOrder, workflowInstances.currentStepOrder)))
      .where(and(eq(transportRequests.tenantId, tenantId), eq(workflowInstances.status, 'active'), or(eq(workflowSteps.assignedUserId, userId), isNull(workflowSteps.assignedUserId))))), href: '/dashboard/approvals', icon: <Shield className="h-5 w-5" /> },
  ];
}

async function getUnreadActivityCount(tenantId: string, userId: string, isPlatform: boolean) {
  const db = getDb();
  const audience = isPlatform ? 'platform' : 'tenant';
  return countRows(db.select({ count: sql<number>`count(*)` })
    .from(notifications)
    .leftJoin(notificationReads, and(eq(notificationReads.notificationId, notifications.id), eq(notificationReads.userId, userId)))
    .where(and(eq(notifications.tenantId, tenantId), eq(notifications.audience, audience), isNull(notificationReads.id))));
}

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session || !isDbConnected()) {
    return <EmptyState icon={<Shield className="h-6 w-6" />} title="Dashboard unavailable" description="Sign in with an active tenant account." />;
  }

  const roleNames = await getSessionRoleNames(session);
  const metrics = await getRoleMetrics(session.tenantId, session.user.id, roleNames);
  const unreadActivity = await getUnreadActivityCount(
    session.tenantId,
    session.user.id,
    roleNames.includes(SystemRoles.PLATFORM_ADMIN),
  );
  const roleLabel = roleNames[0] || 'Employee';
  const links = quickLinks.filter(([href]) => canAccessDashboardPath(href, roleNames));

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`${roleLabel} workspace`} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-5">
            <Bell className="h-5 w-5 text-brand-700" />
            <p className="mt-3 text-2xl font-semibold tabular-nums text-ink-950">{unreadActivity}</p>
            <p className="text-xs text-ink-500">Unread activity updates</p>
            <Link className="mt-3 inline-block text-xs font-medium text-brand-700" href="/dashboard/notifications">View notifications</Link>
          </CardContent>
        </Card>
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardContent className="pt-5">
              <span className="text-brand-700">{metric.icon}</span>
              <p className="mt-3 text-2xl font-semibold tabular-nums text-ink-950">{metric.value}</p>
              <p className="text-xs text-ink-500">{metric.label}</p>
              {metric.href && <Link className="mt-3 inline-block text-xs font-medium text-brand-700" href={metric.href}>Open workspace</Link>}
            </CardContent>
          </Card>
        ))}
      </div>
      {links.length > 0 && (
        <Card>
          <CardContent className="pt-5">
            <h2 className="text-sm font-semibold text-ink-950">Your workspaces</h2>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {links.map(([href, label]) => (
                <Link key={href} href={href} className="rounded-[8px] border border-border px-4 py-3 text-sm text-ink-700 transition-colors hover:border-brand-200 hover:bg-brand-50/40">
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
