'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Building2,
  Car,
  CheckCircle2,
  CircleAlert,
  Database,
  Mail,
  MonitorPlay,
  Package,
  RefreshCw,
  Server,
  Settings,
  ShieldCheck,
  Truck,
  UserCog,
  UserPlus,
  Users,
  Wrench,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { formatDate } from '@/lib/utils';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';
import { SystemRoles } from '@/lib/workspaces';

interface DashboardData {
  tenants: { total: number; active: number; suspended: number; trial: number };
  totalMembers: number;
  vehicles: { total: number; available: number; maintenance: number };
  requests: { total: number };
  trips: { total: number; active: number };
  intake: {
    demos: { total: number; new: number; qualified: number; scheduled: number };
    enquiries: { total: number; new: number; inProgress: number };
  };
  recentTenants: Array<{ id: string; name: string; code: string; type: string; status: string; lifecycleStatus: string; createdAt: string }>;
  envHealth: { database: boolean; backgroundJobs: boolean; errorMonitoring: boolean; email: boolean };
}

const METRIC_TONES = [
  { icon: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300', value: 'text-brand-700 dark:text-brand-300', border: 'border-brand-200/80 dark:border-brand-900/70' },
  { icon: 'bg-status-success-bg text-status-success-text', value: 'text-status-success-text', border: 'border-status-success-text/20' },
  { icon: 'bg-status-pending-bg text-status-pending-text', value: 'text-status-pending-text', border: 'border-status-pending-text/20' },
  { icon: 'bg-status-warning-bg text-status-warning-text', value: 'text-status-warning-text', border: 'border-status-warning-text/20' },
  { icon: 'bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300', value: 'text-brand-700 dark:text-brand-300', border: 'border-brand-200/80 dark:border-brand-900/70' },
  { icon: 'bg-status-error-bg text-status-error-text', value: 'text-status-error-text', border: 'border-status-error-text/20' },
] as const;

function tenantStatusVariant(status: string) {
  const value = status.toUpperCase();
  if (value === 'ACTIVE') return 'success' as const;
  if (value === 'SUSPENDED') return 'error' as const;
  if (value === 'TRIAL') return 'warning' as const;
  return 'default' as const;
}

export default function PlatformDashboardPage() {
  const profileQuery = useQuery({ queryKey: userProfileQueryKey, queryFn: ({ signal }) => fetchUserProfile(signal) });
  const dashboardQuery = useQuery<DashboardData>({
    queryKey: ['platform-dashboard-v2'],
    queryFn: async () => {
      const res = await fetch('/api/platform/dashboard');
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load Platform Dashboard');
      return json.data as DashboardData;
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });

  if (dashboardQuery.isLoading) {
    return <div className="flex min-h-64 items-center justify-center text-sm text-ink-500" role="status">Loading Platform Dashboard…</div>;
  }

  if (dashboardQuery.error || !dashboardQuery.data) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Platform Administration' }]} />
        <PageHeader title="Platform Administration" description="Tenant, public intake and platform operations." />
        <EmptyState icon={<Server className="h-6 w-6" />} title="Platform Dashboard unavailable" description={dashboardQuery.error instanceof Error ? dashboardQuery.error.message : 'Unable to load platform metrics.'} action={{ label: 'Retry', onClick: () => dashboardQuery.refetch() }} />
      </div>
    );
  }

  const data = dashboardQuery.data;
  const roleNames = profileQuery.data?.roles.map((role) => role.roleName) ?? [];
  const isAdmin = roleNames.includes(SystemRoles.PLATFORM_ADMIN);
  const canHandleIntake = isAdmin || roleNames.includes(SystemRoles.PLATFORM_SUPPORT);
  const canAudit = isAdmin || roleNames.includes(SystemRoles.PLATFORM_AUDITOR);
  const metricItems = [
    { label: 'Tenants', value: data.tenants.total, detail: `${data.tenants.active} active`, icon: Building2, href: '/dashboard/platform/tenants' },
    { label: 'Tenant memberships', value: data.totalMembers, detail: 'Protected tenant access records', icon: Users, href: isAdmin ? '/dashboard/platform/users' : '/dashboard/platform/tenants' },
    { label: 'Fleet vehicles', value: data.vehicles.total, detail: `${data.vehicles.available} available · protected`, icon: Car, href: '/dashboard/platform/tenants' },
    { label: 'Transport requests', value: data.requests.total, detail: 'Across all tenants', icon: Activity, href: canAudit ? '/dashboard/platform/audit' : '/dashboard/platform/tenants' },
    { label: 'Trips', value: data.trips.total, detail: `${data.trips.active} active`, icon: Truck, href: canAudit ? '/dashboard/platform/audit' : '/dashboard/platform/tenants' },
    { label: 'Vehicles in maintenance', value: data.vehicles.maintenance, detail: 'Current protected vehicle status', icon: Wrench, href: '/dashboard/platform/tenants' },
  ];

  const health = [
    ['Database', data.envHealth.database],
    ['Email', data.envHealth.email],
    ['Background jobs', data.envHealth.backgroundJobs],
    ['Error monitoring', data.envHealth.errorMonitoring],
  ] as const;

  return (
    <div className="space-y-7">
      <Breadcrumbs items={[{ label: 'Platform Administration' }]} />
      <PageHeader title="Platform Administration" description="Operate tenant onboarding, public enquiries, demonstrations and platform-wide controls.">
        <div className="flex flex-wrap gap-2">
          {isAdmin && <Button size="sm" asChild><Link href="/dashboard/platform/onboard"><UserPlus className="h-4 w-4" /> Onboard tenant</Link></Button>}
          {isAdmin && <Button variant="secondary" size="sm" asChild><Link href="/dashboard/platform/users"><UserCog className="h-4 w-4" /> Platform users</Link></Button>}
          {isAdmin && <Button variant="secondary" size="sm" asChild><Link href="/dashboard/platform/packages"><Package className="h-4 w-4" /> Packages</Link></Button>}
          <Button variant="secondary" size="sm" onClick={() => void dashboardQuery.refetch()} loading={dashboardQuery.isFetching}><RefreshCw className="h-4 w-4" /> Refresh</Button>
        </div>
      </PageHeader>

      {canHandleIntake && <section aria-labelledby="platform-intake-title" className="space-y-3">
        <div><h2 id="platform-intake-title" className="text-base font-semibold text-ink-950">Public intake</h2><p className="mt-0.5 text-xs text-ink-500">Submissions from the public website that need Platform Administrator attention.</p></div>
        <div className="grid gap-3 lg:grid-cols-2">
          <Link href="/dashboard/platform/demo-requests" className="focus-ring group rounded-[10px] border border-brand-200 bg-surface p-5 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none dark:border-brand-900/70">
            <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300"><MonitorPlay className="h-5 w-5" /></div><div><h3 className="text-sm font-semibold text-ink-950">Demo Requests</h3><p className="mt-1 text-xs leading-relaxed text-ink-500">Qualify prospects, schedule walkthroughs, create sandboxes and convert successful evaluations.</p></div></div>{data.intake.demos.new > 0 && <Badge variant="warning" size="sm">{data.intake.demos.new} new</Badge>}</div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs"><div><p className="text-lg font-semibold tabular-nums text-brand-700 dark:text-brand-300">{data.intake.demos.total}</p><p className="text-ink-500">Total</p></div><div><p className="text-lg font-semibold tabular-nums text-status-warning-text">{data.intake.demos.qualified}</p><p className="text-ink-500">Qualified</p></div><div><p className="text-lg font-semibold tabular-nums text-status-success-text">{data.intake.demos.scheduled}</p><p className="text-ink-500">Scheduled</p></div></div>
          </Link>

          <Link href="/dashboard/platform/enquiries" className="focus-ring group rounded-[10px] border border-status-pending-text/20 bg-surface p-5 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none">
            <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-start gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-status-pending-bg text-status-pending-text"><Mail className="h-5 w-5" /></div><div><h3 className="text-sm font-semibold text-ink-950">Public Enquiries</h3><p className="mt-1 text-xs leading-relaxed text-ink-500">Messages from the Contact page. Take ownership, record the response and resolve the interaction.</p></div></div>{data.intake.enquiries.new > 0 && <Badge variant="info" size="sm">{data.intake.enquiries.new} new</Badge>}</div>
            <div className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-3 text-xs"><div><p className="text-lg font-semibold tabular-nums text-status-pending-text">{data.intake.enquiries.total}</p><p className="text-ink-500">Total</p></div><div><p className="text-lg font-semibold tabular-nums text-brand-700 dark:text-brand-300">{data.intake.enquiries.new}</p><p className="text-ink-500">New</p></div><div><p className="text-lg font-semibold tabular-nums text-status-warning-text">{data.intake.enquiries.inProgress}</p><p className="text-ink-500">In progress</p></div></div>
          </Link>
        </div>
      </section>}

      <section aria-labelledby="platform-overview-title" className="space-y-3">
        <h2 id="platform-overview-title" className="text-base font-semibold text-ink-950">Platform overview</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metricItems.map((metric, index) => {
            const Icon = metric.icon;
            const tone = METRIC_TONES[index % METRIC_TONES.length];
            return (
              <Link key={metric.label} href={metric.href} className={`focus-ring group rounded-[10px] border bg-surface p-4 transition-[transform,box-shadow,border-color] hover:-translate-y-0.5 hover:shadow-sm motion-reduce:transform-none motion-reduce:transition-none ${tone.border}`}>
                <div className="flex items-start justify-between gap-3">
                  <div><p className={`text-3xl font-[650] tabular-nums ${tone.value}`}>{metric.value}</p><p className="mt-1 text-sm font-semibold text-ink-800">{metric.label}</p><p className="mt-1 text-xs text-ink-500">{metric.detail}</p></div>
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] ${tone.icon}`}><Icon className="h-5 w-5" /></div>
                </div>
              </Link>
            );
          })}
        </div>
        <div className="flex items-start gap-2 rounded-[8px] border border-border bg-muted/30 px-3 py-2.5 text-xs leading-relaxed text-ink-600">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-success-text" />
          <p>
            Reset-aware totals: tenant operational resets clear requests and trips; the platform operational reset clears demo requests and public enquiries. Tenants, memberships, fleet vehicles and vehicle statuses are protected master data and remain visible.
          </p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <Card>
          <CardHeader><CardTitle>Recent tenants</CardTitle></CardHeader>
          <CardContent className="p-0">
            {data.recentTenants.length === 0 ? <div className="p-5"><EmptyState icon={<Building2 className="h-6 w-6" />} title="No tenants yet" description="No tenant organisations are currently configured." action={isAdmin ? { label: 'Onboard tenant', href: '/dashboard/platform/onboard' } : undefined} /></div> : <div className="divide-y divide-border">{data.recentTenants.map((tenant) => <Link key={tenant.id} href={`/dashboard/platform/tenants/${tenant.id}`} className="focus-ring flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center sm:justify-between motion-reduce:transition-none"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-ink-950">{tenant.name}</p><Badge variant={tenantStatusVariant(tenant.status)} size="sm">{tenant.status.toLowerCase()}</Badge></div><p className="mt-1 text-xs text-ink-500">{tenant.code} · {tenant.type.replace(/_/g, ' ')} · created {formatDate(tenant.createdAt)}</p></div><Badge variant="default" size="sm">{tenant.lifecycleStatus.replace(/_/g, ' ').toLowerCase()}</Badge></Link>)}</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Platform services</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {health.map(([label, online]) => <div key={label} className="flex items-center justify-between gap-3 rounded-[8px] border border-border px-3 py-2.5"><div className="flex items-center gap-2">{online ? <CheckCircle2 className="h-4 w-4 text-status-success-text" /> : <CircleAlert className="h-4 w-4 text-status-warning-text" />}<span className="text-sm text-ink-700">{label}</span></div><Badge variant={online ? 'success' : 'warning'} size="sm">{online ? 'Configured' : 'Attention'}</Badge></div>)}
            {isAdmin && <div className="pt-2"><Button variant="secondary" size="sm" asChild><Link href="/dashboard/platform/billing"><Settings className="h-4 w-4" /> Billing settings</Link></Button></div>}
          </CardContent>
        </Card>
      </div>

      {data.vehicles.total === 0 && data.trips.total === 0 && (
        <section className="grid gap-4 lg:grid-cols-2" aria-label="Operational data status">
          <div className="rounded-[10px] border border-border bg-surface p-5"><div className="flex items-start gap-3"><Database className="mt-0.5 h-5 w-5 text-brand-700 dark:text-brand-300" /><div><h3 className="text-sm font-semibold text-ink-950">No fleet data yet</h3><p className="mt-1 text-xs leading-relaxed text-ink-500">This is expected for a new platform or empty tenants. Fleet records are created inside each tenant workspace, not from the Platform Dashboard.</p><Button variant="ghost" size="sm" className="mt-2" asChild><Link href="/dashboard/platform/tenants">Open tenant management</Link></Button></div></div></div>
          <div className="rounded-[10px] border border-border bg-surface p-5"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-status-success-text" /><div><h3 className="text-sm font-semibold text-ink-950">No active trip activity</h3><p className="mt-1 text-xs leading-relaxed text-ink-500">Trip activity appears after tenants complete setup and begin operational use. Nothing is missing from this Platform Admin view.</p>{canHandleIntake && <Button variant="ghost" size="sm" className="mt-2" asChild><Link href="/dashboard/platform/demo-requests">Review demo pipeline</Link></Button>}</div></div></div>
        </section>
      )}
    </div>
  );
}
