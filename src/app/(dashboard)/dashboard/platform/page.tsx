'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Activity,
  Building2,
  CarFront,
  Database,
  FileText,
  Fuel,
  Gauge,
  Globe,
  Loader2,
  Package,
  RefreshCcw,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

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

interface StatItem {
  icon: LucideIcon;
  label: string;
  value: number | string;
  sub: string;
  tone?: 'brand' | 'success' | 'warning' | 'info' | 'error';
}

const toneClasses: Record<NonNullable<StatItem['tone']>, string> = {
  brand: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-600',
  success: 'bg-status-success-bg text-status-success-text',
  warning: 'bg-status-warning-bg text-status-warning-text',
  info: 'bg-status-info-bg text-status-info-text',
  error: 'bg-status-error-bg text-status-error-text',
};

export default function PlatformDashboardPage() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
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
        <div className="flex min-h-48 items-center justify-center" role="status" aria-label="Loading platform analytics">
          <Loader2 className="h-6 w-6 animate-spin text-ink-400 motion-reduce:animate-none" aria-hidden="true" />
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
  const averagePerTenant = (value: number) => Math.round(value / Math.max(summary.totalTenants, 1));

  const stats: StatItem[] = [
    {
      icon: Globe,
      label: 'Tenants',
      value: summary.totalTenants,
      sub: `${summary.activeTenants} active`,
      tone: 'brand',
    },
    {
      icon: CarFront,
      label: 'Vehicles',
      value: summary.totalVehicles,
      sub: 'Across all tenants',
      tone: 'info',
    },
    {
      icon: Gauge,
      label: 'Active Trips',
      value: summary.activeTrips,
      sub: `${averagePerTenant(summary.activeTrips)} avg/tenant`,
      tone: summary.activeTrips > 0 ? 'warning' : 'brand',
    },
    {
      icon: Users,
      label: 'Employees',
      value: summary.totalEmployees,
      sub: `${averagePerTenant(summary.totalEmployees)} avg/tenant`,
      tone: 'brand',
    },
    {
      icon: FileText,
      label: 'Transport Requests',
      value: summary.totalRequests,
      sub: `${averagePerTenant(summary.totalRequests)} avg/tenant`,
      tone: 'info',
    },
    {
      icon: TrendingUp,
      label: 'Trips',
      value: summary.totalTrips,
      sub: `${averagePerTenant(summary.totalTrips)} avg/tenant`,
      tone: 'success',
    },
    {
      icon: Fuel,
      label: 'Fuel Volume',
      value: `${Math.round(summary.totalFuelLitres).toLocaleString()} L`,
      sub: `N$${Math.round(summary.totalFuelCost).toLocaleString()} total cost`,
      tone: 'warning',
    },
    {
      icon: Activity,
      label: 'Fuel Cost',
      value: `N$${Math.round(summary.totalFuelCost).toLocaleString()}`,
      sub: `Avg N$${summary.totalFuelLitres > 0 ? (summary.totalFuelCost / summary.totalFuelLitres).toFixed(2) : '0.00'}/L`,
      tone: 'brand',
    },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Platform' },
        ]}
      />
      <PageHeader
        title="Platform Dashboard"
        description={`Cross-tenant analytics for ${summary.activeTenants} of ${summary.totalTenants} active tenants`}
      >
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/platform/packages">
            <Package className="h-4 w-4" aria-hidden="true" /> Subscription Packages
          </Link>
        </Button>
        <Button variant="secondary" size="sm" asChild>
          <Link href="/dashboard/platform/tenants">
            <Building2 className="h-4 w-4" aria-hidden="true" /> Manage Tenants
          </Link>
        </Button>
      </PageHeader>

      <section aria-label="Platform summary" className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8">
          {stats.map((stat, index) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className={cn(
                  'min-w-0 px-4 py-4 sm:px-4 sm:py-5',
                  index % 2 !== 0 && 'border-l border-border',
                  index >= 2 && 'border-t border-border sm:border-t-0',
                  index >= 4 && 'sm:border-t sm:border-border xl:border-t-0',
                  index > 0 && 'xl:border-l xl:border-border',
                )}
              >
                <div className={cn('flex h-8 w-8 items-center justify-center rounded-[8px]', toneClasses[stat.tone ?? 'brand'])}>
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <p className="mt-3 truncate text-xl font-[650] tabular-nums text-ink-950 sm:text-2xl" title={String(stat.value)}>
                  {stat.value}
                </p>
                <p className="mt-0.5 truncate text-xs font-medium text-ink-700">{stat.label}</p>
                <p className="mt-0.5 truncate text-[11px] text-ink-400" title={stat.sub}>{stat.sub}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardContent className="pt-4">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-[650] text-ink-950">
              <CarFront className="h-4 w-4 text-brand-700" aria-hidden="true" /> Vehicles per Tenant
            </h2>
            {tenantBreakdown.vehicles.length === 0 ? (
              <p className="text-xs text-ink-500">No vehicles registered</p>
            ) : (
              <div className="space-y-3">
                {tenantBreakdown.vehicles.map((tenant) => {
                  const max = Math.max(...tenantBreakdown.vehicles.map((item) => item.vehicleCount), 1);
                  return (
                    <div key={tenant.tenantId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(84px,34%)] items-center gap-3">
                      <span className="truncate text-sm text-ink-700">{tenant.tenantName}</span>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min((tenant.vehicleCount / max) * 100, 100)}%` }} />
                        </div>
                        <span className="w-8 text-right text-sm font-medium tabular-nums text-ink-950">{tenant.vehicleCount}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-4">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-[650] text-ink-950">
              <Gauge className="h-4 w-4 text-status-warning-text" aria-hidden="true" /> Active Trips per Tenant
            </h2>
            {tenantBreakdown.activeTrips.length === 0 ? (
              <p className="text-xs text-ink-500">No active trips</p>
            ) : (
              <div className="space-y-3">
                {tenantBreakdown.activeTrips.map((tenant) => {
                  const max = Math.max(...tenantBreakdown.activeTrips.map((item) => item.activeTripCount), 1);
                  return (
                    <div key={tenant.tenantId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(84px,34%)] items-center gap-3">
                      <Link href={`/dashboard/platform/tenants/${tenant.tenantId}`} className="truncate text-sm text-ink-700 transition-colors hover:text-brand-700 motion-reduce:transition-none">
                        {tenant.tenantName}
                      </Link>
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-status-warning-text" style={{ width: `${Math.min((tenant.activeTripCount / max) * 100, 100)}%` }} />
                        </div>
                        <span className="w-8 text-right text-sm font-medium tabular-nums text-ink-950">{tenant.activeTripCount}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="border-t border-border pt-5" aria-labelledby="platform-quick-actions">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="platform-quick-actions" className="text-sm font-[650] text-ink-950">Quick Actions</h2>
            <p className="mt-0.5 text-xs text-ink-500">Open the platform areas used most often.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/platform/tenants"><Building2 className="h-4 w-4" aria-hidden="true" /> All Tenants</Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/platform/packages"><Package className="h-4 w-4" aria-hidden="true" /> Packages</Link>
            </Button>
            <Button variant="secondary" size="sm" asChild>
              <Link href="/dashboard/share-links"><Globe className="h-4 w-4" aria-hidden="true" /> Share Links</Link>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => refetch()} loading={isFetching}>
              <RefreshCcw className="h-4 w-4" aria-hidden="true" /> Refresh
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
