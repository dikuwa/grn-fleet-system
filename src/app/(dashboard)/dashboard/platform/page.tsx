'use client';

import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Building2, CarFront, Gauge, Users, FileText, Fuel, Loader2,
  Database, Globe, TrendingUp, BarChart3, Activity, RefreshCcw,
} from 'lucide-react';
import Link from 'next/link';


interface AnalyticsData {
  summary: {
    totalTenants: number;
    activeTenants: number;
    totalVehicles: number;
    totalTrips: number;
    activeTrips: number;
    totalEmployees: number;
    totalRequests: number;
    totalFuelLitres: number;
    totalFuelCost: number;
  };
  tenantBreakdown: {
    vehicles: Array<{ tenantId: string; tenantName: string; vehicleCount: number }>;
    activeTrips: Array<{ tenantId: string; tenantName: string; activeTripCount: number }>;
  };
}

export default function PlatformDashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['platform-analytics'],
    queryFn: async () => {
      const res = await fetch('/api/platform/analytics');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load platform analytics');
      return json.data as AnalyticsData;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Platform' }]} />
        <PageHeader title="Platform Dashboard" description="Cross-tenant analytics and management" />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Platform' }]} />
        <PageHeader title="Platform Dashboard" description="Cross-tenant analytics and management" />
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title={error instanceof Error ? error.message : 'Unable to load analytics'}
          action={{ label: 'Retry', onClick: () => refetch() }}
        />
      </div>
    );
  }

  const { summary, tenantBreakdown } = data;

  const statCards = [
    { icon: Globe, label: 'Total Tenants', value: summary.totalTenants, sub: `${summary.activeTenants} active`, color: 'bg-blue-50 text-blue-700' },
    { icon: CarFront, label: 'Total Vehicles', value: summary.totalVehicles, sub: 'across all tenants', color: 'bg-green-50 text-green-700' },
    { icon: Gauge, label: 'Active Trips', value: summary.activeTrips, sub: `${Math.round(summary.activeTrips / Math.max(summary.totalTenants, 1))} avg/tenant`, color: 'bg-amber-50 text-amber-700', highlight: summary.activeTrips > 0 },
    { icon: Users, label: 'Total Employees', value: summary.totalEmployees, sub: `${Math.round(summary.totalEmployees / Math.max(summary.totalTenants, 1))} avg/tenant`, color: 'bg-purple-50 text-purple-700' },
    { icon: FileText, label: 'Transport Requests', value: summary.totalRequests, sub: `${Math.round(summary.totalRequests / Math.max(summary.totalTenants, 1))} avg/tenant`, color: 'bg-indigo-50 text-indigo-700' },
    { icon: TrendingUp, label: 'Total Trips', value: summary.totalTrips, sub: `${Math.round(summary.totalTrips / Math.max(summary.totalTenants, 1))} avg/tenant`, color: 'bg-teal-50 text-teal-700' },
    { icon: Fuel, label: 'Fuel Volume', value: `${Math.round(summary.totalFuelLitres).toLocaleString()} L`, sub: `N$${Math.round(summary.totalFuelCost).toLocaleString()} total cost`, color: 'bg-orange-50 text-orange-700' },
    { icon: Activity, label: 'Fuel Cost', value: `N$${Math.round(summary.totalFuelCost).toLocaleString()}`, sub: `Avg N$${summary.totalFuelLitres > 0 ? (summary.totalFuelCost / summary.totalFuelLitres).toFixed(2) : '0.00'}/L`, color: 'bg-rose-50 text-rose-700' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Platform' },
      ]} />
      <PageHeader
        title="Platform Dashboard"
        description={`Cross-tenant analytics for ${summary.activeTenants} of ${summary.totalTenants} active tenants`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/platform/tenants">
            <Building2 className="h-4 w-4" /> Manage Tenants
          </Link>
        </Button>
      </PageHeader>

      {/* Summary Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label}>
            <CardContent className="pt-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className={`flex h-10 w-10 items-center justify-center rounded-lg ${stat.color}`}>
                    <stat.icon className="h-5 w-5" />
                  </p>
                </div>
                {stat.highlight && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400">
                    <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  </span>
                )}
              </div>
              <p className="mt-3 text-2xl font-[650] tabular-nums text-ink-950">{stat.value}</p>
              <p className="text-xs text-ink-500">{stat.label}</p>
              <p className="text-[11px] text-ink-400">{stat.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Per-Tenant Breakdown */}
      <div className="grid gap-6 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-[650] text-ink-950 mb-3 flex items-center gap-2">
              <CarFront className="h-4 w-4 text-brand-700" /> Vehicles per Tenant
            </h3>
            {tenantBreakdown.vehicles.length === 0 ? (
              <p className="text-xs text-ink-500">No vehicles registered</p>
            ) : (
              <div className="space-y-2">
                {tenantBreakdown.vehicles.map((t) => (
                  <div key={t.tenantId} className="flex items-center justify-between">
                    <span className="text-sm text-ink-700 truncate flex-1">{t.tenantName}</span>
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded-full bg-brand-200" style={{ width: `${Math.min((t.vehicleCount / Math.max(...tenantBreakdown.vehicles.map((x) => x.vehicleCount), 1)) * 100, 100)}px` }} />
                      <span className="text-sm font-medium tabular-nums text-ink-950 w-8 text-right">{t.vehicleCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <h3 className="text-sm font-[650] text-ink-950 mb-3 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-amber-600" /> Active Trips per Tenant
            </h3>
            {tenantBreakdown.activeTrips.length === 0 ? (
              <p className="text-xs text-ink-500">No active trips</p>
            ) : (
              <div className="space-y-2">
                {tenantBreakdown.activeTrips.map((t) => (
                  <div key={t.tenantId} className="flex items-center justify-between">
                    <Link
                      href={`/dashboard/platform/tenants/${t.tenantId}`}
                      className="text-sm text-ink-700 hover:text-brand-700 truncate flex-1 transition-colors"
                    >
                      {t.tenantName}
                    </Link>
                    <div className="flex items-center gap-2">
                      <div className="h-2 rounded-full bg-amber-200" style={{ width: `${Math.min((t.activeTripCount / Math.max(...tenantBreakdown.activeTrips.map((x) => x.activeTripCount), 1)) * 100, 100)}px` }} />
                      <span className="text-sm font-medium tabular-nums text-ink-950 w-8 text-right">{t.activeTripCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardContent className="pt-4">
          <h3 className="text-sm font-[650] text-ink-950 mb-3">Quick Actions</h3>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/platform/tenants"><Building2 className="h-4 w-4" /> All Tenants</Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/share-links"><Globe className="h-4 w-4" /> Share Links</Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              <RefreshCcw className="h-4 w-4" /> Refresh Analytics
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
