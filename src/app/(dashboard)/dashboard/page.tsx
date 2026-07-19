import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/ui/card';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Clock,
  Truck,
  AlertTriangle,
  Fuel,
  TrendingUp,
  Wrench,
  Database,
  Gauge,
  User,
  ChevronRight,
} from 'lucide-react';
import { getDb, isDbConnected } from '@/db';
import { transportRequests } from '@/db/schema/requests';
import { vehicles, vehicleDefects } from '@/db/schema/fleet';
import { workflowInstances } from '@/db/schema/workflows';
import { fuelTransactions, trips } from '@/db/schema/trips';
import { employees } from '@/db/schema/people';
import { getServerSession } from '@/lib/session';
import { eq, and, desc, sql, isNull, gte, ne } from 'drizzle-orm';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate, formatDateTime } from '@/lib/utils';
import Link from 'next/link';

async function fetchDashboardData(tenantId: string) {
  const db = getDb();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    requestCounts,
    vehicleCounts,
    defectCounts,
    tripCounts,
    recentReqs,
    fuelMonth,
    pendingApprovals,
    activeTrips,
  ] = await Promise.all([
    // Request counts by status
    db
      .select({
        status: transportRequests.status,
        count: sql<number>`count(*)`,
      })
      .from(transportRequests)
      .where(eq(transportRequests.tenantId, tenantId))
      .groupBy(transportRequests.status),
    // Vehicle counts by status
    db
      .select({
        status: vehicles.status,
        count: sql<number>`count(*)`,
      })
      .from(vehicles)
      .where(and(eq(vehicles.tenantId, tenantId), eq(vehicles.isActive, true)))
      .groupBy(vehicles.status),
    // Open defect count (join through vehicles for tenant isolation)
    db
      .select({ count: sql<number>`count(*)` })
      .from(vehicleDefects)
      .innerJoin(vehicles, eq(vehicleDefects.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicles.tenantId, tenantId),
          isNull(vehicleDefects.resolvedAt),
        ),
      ),
    // Active trip count
    db
      .select({ count: sql<number>`count(*)` })
      .from(trips)
      .where(
        and(
          eq(trips.tenantId, tenantId),
          eq(trips.status, 'in_progress'),
        ),
      ),
    // Recent requests (last 5)
    db
      .select({
        id: transportRequests.id,
        reference: transportRequests.reference,
        purpose: transportRequests.purpose,
        status: transportRequests.status,
        createdAt: transportRequests.createdAt,
        requesterFirstName: employees.firstName,
        requesterLastName: employees.lastName,
      })
      .from(transportRequests)
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(eq(transportRequests.tenantId, tenantId))
      .orderBy(desc(transportRequests.createdAt))
      .limit(5),
    // Fuel this month (join through vehicles for tenant isolation)
    db
      .select({ total: sql<number>`coalesce(sum(fuel_transactions.litres), 0)` })
      .from(fuelTransactions)
      .innerJoin(vehicles, eq(fuelTransactions.vehicleId, vehicles.id))
      .where(
        and(
          eq(vehicles.tenantId, tenantId),
          gte(fuelTransactions.transactionAt, startOfMonth),
        ),
      ),
    // Active workflow instances (join through transport requests for tenant isolation)
    db
      .select({ count: sql<number>`count(*)` })
      .from(workflowInstances)
      .innerJoin(transportRequests, eq(workflowInstances.requestId, transportRequests.id))
      .where(
        and(
          eq(transportRequests.tenantId, tenantId),
          eq(workflowInstances.status, 'active'),
        ),
      ),
    // Active trips list (in_progress or return_due) — last 5
    db
      .select({
        id: trips.id,
        status: trips.status,
        startedAt: trips.startedAt,
        createdAt: trips.createdAt,
        requestReference: transportRequests.reference,
        requestPurpose: transportRequests.purpose,
        make: vehicles.make,
        model: vehicles.model,
        licenceNumber: vehicles.licenceNumber,
        driverFirstName: employees.firstName,
        driverLastName: employees.lastName,
      })
      .from(trips)
      .leftJoin(vehicles, eq(trips.vehicleId, vehicles.id))
      .leftJoin(transportRequests, eq(trips.requestId, transportRequests.id))
      .leftJoin(employees, eq(transportRequests.requesterEmployeeId, employees.id))
      .where(
        and(
          eq(trips.tenantId, tenantId),
          ne(trips.status, 'closed'),
          ne(trips.status, 'pending'),
        ),
      )
      .orderBy(desc(trips.startedAt))
      .limit(5),
  ]);

  // Derive summary counts
  const activeRequests = requestCounts
    .filter((r) => !['draft', 'closed', 'cancelled'].includes(r.status))
    .reduce((sum, r) => sum + r.count, 0);
  const approvalPendingCount = requestCounts
    .filter((r) => ['submitted', 'supervisor_review', 'transport_review'].includes(r.status))
    .reduce((sum, r) => sum + r.count, 0);

  const availableCount = vehicleCounts.find((v) => v.status === 'available')?.count ?? 0;
  const onTripCount = vehicleCounts.filter((v) =>
    ['issued', 'allocated', 'provisional'].includes(v.status),
  ).reduce((sum, v) => sum + v.count, 0);
  const maintenanceCount = vehicleCounts.find((v) => v.status === 'maintenance')?.count ?? 0;
  const outOfServiceCount = vehicleCounts.filter((v) =>
    ['out_of_service', 'written_off'].includes(v.status),
  ).reduce((sum, v) => sum + v.count, 0);

  const openDefectTotal = Number(defectCounts[0]?.count ?? 0);
  const activeTripCount = Number(tripCounts[0]?.count ?? 0);
  const fuelThisMonth = Number(fuelMonth[0]?.total ?? 0);
  const pendingApprovalCount = Number(pendingApprovals[0]?.count ?? 0);

  return {
    activeRequests,
    approvalPendingCount,
    activeTripCount,
    openDefectTotal,
    availableCount,
    onTripCount,
    maintenanceCount,
    outOfServiceCount,
    fuelThisMonth,
    pendingApprovalCount,
    recentRequests: recentReqs,
    activeTrips,
  };
}

export default async function DashboardPage() {
  const session = await getServerSession();
  if (!session) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Fleet Operations Overview" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Authentication Required"
          description="Sign in to view fleet operations data."
        />
      </div>
    );
  }

  if (!isDbConnected()) {
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Fleet Operations Overview" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Database Not Configured"
          description="Set the DATABASE_URL environment variable and run migrations."
        />
      </div>
    );
  }

  let data: Awaited<ReturnType<typeof fetchDashboardData>>;
  try {
    data = await fetchDashboardData(session.tenantId);
  } catch (error) {
    console.error('Dashboard query failed:', error);
    return (
      <div className="space-y-6">
        <PageHeader title="Dashboard" description="Fleet Operations Overview" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="Unable to Load Dashboard"
          description="The database query failed. Please try again later."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Fleet Operations Overview"
      />

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Requests"
          value={String(data.activeRequests)}
          description="Awaiting processing"
          icon={<FileText className="h-5 w-5" />}
        />
        <StatCard
          title="Active Trips"
          value={String(data.activeTripCount)}
          description="Vehicles on the road"
          icon={<Truck className="h-5 w-5" />}
        />
        <StatCard
          title="Pending Approvals"
          value={String(data.pendingApprovalCount)}
          description="Awaiting decision"
          icon={<Clock className="h-5 w-5" />}
        />
        <StatCard
          title="Open Defects"
          value={String(data.openDefectTotal)}
          description="Needs attention"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
      </div>

      {/* Active Trips */}
      {data.activeTrips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-status-info-text" />
              Active Trips ({data.activeTrips.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.activeTrips.map((trip) => {
                const driverName = trip.driverFirstName && trip.driverLastName
                  ? `${trip.driverFirstName} ${trip.driverLastName}`
                  : null;
                return (
                  <Link
                    key={trip.id}
                    href={`/dashboard/trips/${trip.id}`}
                    className="flex items-center justify-between rounded-[8px] border border-border p-3 transition-colors hover:border-brand-100 hover:bg-brand-50/20"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-amber-50">
                        <Truck className="h-5 w-5 text-amber-700" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink-950">{trip.make} {trip.model}</p>
                          <Badge variant={trip.status === 'return_due' ? 'emergency' : 'info'} size="sm">
                            {trip.status === 'return_due' ? 'RETURN DUE' : trip.status.replace(/_/g, ' ')}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-ink-500">
                          <span>{trip.licenceNumber}</span>
                          {trip.requestReference && <span>{trip.requestReference}</span>}
                          {driverName && <span className="flex items-center gap-1"><User className="h-3 w-3" />{driverName}</span>}
                          <span className="tabular-nums">{trip.startedAt ? formatDateTime(trip.startedAt) : formatDate(trip.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-ink-300 shrink-0" />
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Activity & Quick Stats */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent Requests */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Recent Transport Requests</CardTitle>
          </CardHeader>
          <CardContent>
            {data.recentRequests.length === 0 ? (
              <div className="rounded-[8px] border border-dashed border-border p-6 text-center">
                <FileText className="mx-auto mb-2 h-5 w-5 text-ink-300" />
                <p className="text-sm text-ink-500">No transport requests yet.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {data.recentRequests.map((request) => {
                  const requesterName =
                    request.requesterFirstName && request.requesterLastName
                      ? `${request.requesterFirstName} ${request.requesterLastName}`
                      : 'Unknown';
                  return (
                    <Link
                      key={request.id}
                      href={`/dashboard/requests/${request.id}`}
                      className="flex items-center justify-between rounded-[8px] border border-border p-3 transition-colors hover:border-brand-100 hover:bg-brand-50/20"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-ink-950 truncate">
                          {request.purpose || request.reference || 'Untitled'}
                        </p>
                        <p className="text-xs text-ink-500">
                          {requesterName} &middot; {formatDate(request.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`ml-3 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          request.status === 'approved' || request.status === 'closed'
                            ? 'bg-status-success-bg text-status-success-text'
                            : request.status === 'submitted' || request.status === 'supervisor_review'
                              ? 'bg-status-pending-bg text-status-pending-text'
                              : 'bg-status-info-bg text-status-info-text'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            request.status === 'approved' || request.status === 'closed'
                              ? 'bg-status-success-text'
                              : request.status === 'submitted' || request.status === 'supervisor_review'
                                ? 'bg-status-pending-text'
                                : 'bg-status-info-text'
                          }`}
                        />
                        {request.status}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fleet Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Fleet Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: 'Available', value: data.availableCount, icon: Truck, bgColor: 'bg-status-success-bg', iconColor: 'text-status-success-text' },
              { label: 'On Trip', value: data.onTripCount, icon: TrendingUp, bgColor: 'bg-status-info-bg', iconColor: 'text-status-info-text' },
              { label: 'In Maintenance', value: data.maintenanceCount, icon: Wrench, bgColor: 'bg-status-pending-bg', iconColor: 'text-status-pending-text' },
              { label: 'Out of Service', value: data.outOfServiceCount, icon: AlertTriangle, bgColor: 'bg-status-error-bg', iconColor: 'text-status-error-text' },
              { label: 'Fuel This Month', value: `${data.fuelThisMonth.toFixed(0)} L`, icon: Fuel, bgColor: 'bg-brand-50', iconColor: 'text-brand-700' },
            ].map((stat, i) => (
              <div key={i} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`flex h-8 w-8 items-center justify-center rounded-[6px] ${stat.bgColor}`}>
                    <stat.icon className={`h-4 w-4 ${stat.iconColor}`} />
                  </div>
                  <span className="text-sm text-ink-700">{stat.label}</span>
                </div>
                <span className="text-sm font-semibold tabular-nums text-ink-950">
                  {stat.value}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}


