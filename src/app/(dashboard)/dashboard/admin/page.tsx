import { getDb, isDbConnected } from '@/db';
import { employees, driverProfiles, driverLicences, tenantMemberships, roleDelegations } from '@/db/schema';
import { transportRequests } from '@/db/schema/requests';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { eq, and, sql, lte, isNull } from 'drizzle-orm';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Users,
  Truck,
  AlertTriangle,
  Clock,
  Shield,
  GitBranch,
  MapPin,
  UserCog,
  ChevronRight,
  Database,
} from 'lucide-react';
import Link from 'next/link';
import { getServerSession } from '@/lib/session';
import { hasPermission } from '@/lib/auth-helpers';
import { Permissions } from '@/lib/permissions';

interface AdminStats {
  totalEmployees: number;
  activeUsers: number;
  pendingUsers: number;
  totalVehicles: number;
  activeRequests: number;
  blockingDefects: number;
  pendingDelegations: number;
  expiringDelegations: number;
  pendingLicenceVerifications: number;
  expiringLicences: number;
}

async function fetchAdminStats(tenantId: string): Promise<AdminStats> {
  const db = getDb();

  const now = new Date();
  const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  const [
    empCount,
    userCount,
    pendingUserCount,
    vehicleCount,
    requestCount,
    defectCount,
    activeDelegations,
    expiringDelegations,
    licenceCount,
    expiringLicences,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(employees)
      .where(and(eq(employees.tenantId, tenantId), eq(employees.employmentStatus, 'active')))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, 'active')))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(tenantMemberships)
      .where(and(eq(tenantMemberships.tenantId, tenantId), eq(tenantMemberships.status, 'pending')))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(vehicles)
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.status, 'available')))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(transportRequests)
      .where(and(eq(transportRequests.tenantId, tenantId), eq(transportRequests.status, 'pending')))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicleDefects.isBlocking, true), isNull(vehicleDefects.resolvedAt)))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(roleDelegations)
      .where(and(eq(roleDelegations.tenantId, tenantId), eq(roleDelegations.status, 'active'), lte(roleDelegations.startAt, now), sql`${roleDelegations.endAt} > ${now}`))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(roleDelegations)
      .where(and(eq(roleDelegations.tenantId, tenantId), eq(roleDelegations.status, 'active'), lte(roleDelegations.startAt, now), sql`${roleDelegations.endAt} > ${now}`, lte(roleDelegations.endAt, thirtyDaysFromNow)))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .where(and(eq(employees.tenantId, tenantId), eq(driverLicences.verificationStatus, 'pending')))
      .then((r) => Number(r[0]?.count || 0)),
    db.select({ count: sql<number>`count(*)` }).from(driverLicences)
      .innerJoin(driverProfiles, eq(driverLicences.driverProfileId, driverProfiles.id))
      .innerJoin(employees, eq(driverProfiles.employeeId, employees.id))
      .where(and(eq(employees.tenantId, tenantId), eq(driverLicences.verificationStatus, 'verified'), lte(sql`DATE(${driverLicences.expiryDate})`, thirtyDaysFromNow)))
      .then((r) => Number(r[0]?.count || 0)),
  ]);

  return {
    totalEmployees: empCount,
    activeUsers: userCount,
    pendingUsers: pendingUserCount,
    totalVehicles: vehicleCount,
    activeRequests: requestCount,
    blockingDefects: defectCount,
    pendingDelegations: activeDelegations,
    expiringDelegations: expiringDelegations,
    pendingLicenceVerifications: licenceCount,
    expiringLicences,
  };
}

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <EmptyState icon={<Database className="h-6 w-6" />} title="Authentication Required" />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <EmptyState icon={<Database className="h-6 w-6" />} title="Database Not Configured" />
      </div>
    );
  }

  let stats: AdminStats;
  try {
    stats = await fetchAdminStats(session.tenantId);
  } catch (error) {
    console.error('Admin stats query failed:', error);
    return (
      <div className="space-y-6">
        <EmptyState icon={<Database className="h-6 w-6" />} title="Unable to Load Admin Dashboard" description="Database query failed." />
      </div>
    );
  }

  const canManageUsers = await hasPermission(session, Permissions.STAFF_MANAGE);
  const canViewDelegations = await hasPermission(session, Permissions.DELEGATION_MANAGE);
  const canViewAudit = await hasPermission(session, Permissions.AUDIT_READ);

  const adminSections = [
    {
      title: 'User Management',
      description: 'Invite users, manage accounts, handle role assignments and acting appointments.',
      href: '/dashboard/admin/users',
      icon: UserCog,
      enabled: canManageUsers,
      stats: [
        { label: 'Active Users', value: stats.activeUsers, variant: 'success' as const },
        { label: 'Pending Invites', value: stats.pendingUsers, variant: 'pending' as const },
      ],
    },
    {
      title: 'Roles & Permissions',
      description: 'Define roles, assign permissions, and configure scope-based access control.',
      href: '/dashboard/admin/roles',
      icon: Shield,
      enabled: canManageUsers,
    },
    {
      title: 'Delegations',
      description: 'Manage acting appointments, delegation assignments, and active/expiring roles.',
      href: '/dashboard/delegations',
      icon: GitBranch,
      enabled: canViewDelegations,
      stats: [
        { label: 'Active', value: stats.pendingDelegations, variant: 'success' as const },
        { label: 'Expiring Soon', value: stats.expiringDelegations, variant: 'warning' as const },
      ],
    },
    {
      title: 'Audit Log',
      description: 'View and export audit trails for all transport operations and administrative actions.',
      href: '/dashboard/audit',
      icon: MapPin,
      enabled: canViewAudit,
    },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Administration' },
      ]} />
      <PageHeader title="Administration" description="Manage users, roles, workflows and organisational settings" />

      {/* Quick Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Active Employees</p>
                <p className="text-2xl font-[650] tabular-nums text-ink-950">{stats.totalEmployees}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-700">
                <Users className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Active Users</p>
                <p className="text-2xl font-[650] tabular-nums text-ink-950">{stats.activeUsers}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-success-bg text-status-success-text">
                <Users className="h-5 w-5" />
              </div>
            </div>
            {stats.pendingUsers > 0 && (
              <Badge variant="pending" size="sm" className="mt-1">{stats.pendingUsers} pending</Badge>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Available Vehicles</p>
                <p className="text-2xl font-[650] tabular-nums text-ink-950">{stats.totalVehicles}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-info-bg text-status-info-text">
                <Truck className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Active Delegations</p>
                <p className="text-2xl font-[650] tabular-nums text-ink-950">{stats.pendingDelegations}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-700">
                <Clock className="h-5 w-5" />
              </div>
            </div>
            {stats.expiringDelegations > 0 && (
              <Badge variant="warning" size="sm" className="mt-1">{stats.expiringDelegations} expiring soon</Badge>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Blocking Defects</p>
                <p className="text-2xl font-[650] tabular-nums text-status-error-text">{stats.blockingDefects}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-error-bg text-status-error-text">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts Section */}
      <div className="grid gap-4 sm:grid-cols-2">
        {(stats.blockingDefects > 0 || stats.pendingLicenceVerifications > 0 || stats.expiringLicences > 0 || stats.pendingUsers > 0) && (
          <Card className="border-2 border-status-warning-bg">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-status-warning-text" />
                Items Requiring Attention
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {stats.blockingDefects > 0 && (
                <Link href="/dashboard/fleet?status=maintenance" className="flex items-center justify-between rounded-[8px] border border-status-error-bg/30 bg-status-error-bg/5 p-3 text-sm hover:bg-status-error-bg/10 transition-colors">
                  <span className="font-medium text-status-error-text">{stats.blockingDefects} blocking vehicle defect(s)</span>
                  <ChevronRight className="h-4 w-4 text-ink-400" />
                </Link>
              )}
              {stats.pendingLicenceVerifications > 0 && (
                <Link href="/dashboard/staff" className="flex items-center justify-between rounded-[8px] border border-status-warning-bg/30 bg-status-warning-bg/5 p-3 text-sm hover:bg-status-warning-bg/10 transition-colors">
                  <span className="font-medium text-status-warning-text">{stats.pendingLicenceVerifications} licence(s) pending verification</span>
                  <ChevronRight className="h-4 w-4 text-ink-400" />
                </Link>
              )}
              {stats.expiringLicences > 0 && (
                <Link href="/dashboard/reports/licence-expiry" className="flex items-center justify-between rounded-[8px] border border-amber-200/30 bg-amber-50/5 p-3 text-sm hover:bg-amber-50/10 transition-colors">
                  <span className="font-medium text-amber-700">{stats.expiringLicences} licence(s) expiring within 30 days</span>
                  <ChevronRight className="h-4 w-4 text-ink-400" />
                </Link>
              )}
              {stats.pendingUsers > 0 && (
                <Link href="/dashboard/admin/users" className="flex items-center justify-between rounded-[8px] border border-brand-200/30 bg-brand-50/5 p-3 text-sm hover:bg-brand-50/10 transition-colors">
                  <span className="font-medium text-brand-700">{stats.pendingUsers} user(s) with pending invites</span>
                  <ChevronRight className="h-4 w-4 text-ink-400" />
                </Link>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Admin Navigation Sections */}
      <div className="grid gap-6 md:grid-cols-2">
        {adminSections
          .filter((section) => section.enabled)
          .map((section) => (
            <Link key={section.href} href={section.href} className="group block">
              <Card className="h-full transition-all hover:border-brand-300 hover:shadow-sm">
                <CardContent className="pt-6">
                  <div className="flex items-start gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] bg-brand-50 text-brand-700 group-hover:bg-brand-100 transition-colors">
                      <section.icon className="h-6 w-6" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-base font-semibold text-ink-950 group-hover:text-brand-700 transition-colors">
                          {section.title}
                        </h3>
                        <ChevronRight className="h-4 w-4 text-ink-400 group-hover:text-brand-600 shrink-0 transition-colors" />
                      </div>
                      <p className="mt-1 text-sm text-ink-500">{section.description}</p>
                      {'stats' in section && section.stats && (
                        <div className="mt-3 flex flex-wrap gap-3">
                          {section.stats.map((stat) => (
                            <div key={stat.label} className="flex items-center gap-1.5">
                              <span className="text-xs text-ink-500">{stat.label}:</span>
                              <Badge variant={stat.variant} size="sm">{stat.value}</Badge>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
      </div>

      {/* Empty state if no admin access */}
      {adminSections.filter((s) => s.enabled).length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-ink-500">
              <Shield className="h-4 w-4" />
              You do not have administrative access. Contact your Tenant Administrator for elevated permissions.
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
