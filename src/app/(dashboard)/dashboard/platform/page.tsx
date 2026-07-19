'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { StatCard } from '@/components/ui/card';
import {
  Globe, Users, Truck, FileText, Gauge, Building2,
  Loader2, Database, CheckCircle2, XCircle, AlertTriangle,
  Clock, RefreshCw, Activity, Smartphone,
} from 'lucide-react';
import Link from 'next/link';
import { formatDate } from '@/lib/utils';

interface EnvHealth {
  database: boolean;
  backgroundJobs: boolean;
  errorMonitoring: boolean;
  email: boolean;
}

interface PlatformDashboardData {
  tenants: { total: number; active: number; suspended: number; inactive: number };
  totalMembers: number;
  vehicles: { total: number; active: number; maintenance: number };
  requests: { totalRequests: number };
  trips: { total: number; active: number };
  recentTenants: { id: string; name: string; code: string; type: string; status: string; createdAt: string }[];
  envHealth: EnvHealth;
}

export default function PlatformDashboardPage() {
  const [data, setData] = useState<PlatformDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchedRef = useRef(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/platform/dashboard');
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || 'Failed to load platform data');
      }
      const json = await res.json();
      setData(json.data as PlatformDashboardData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load platform data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Platform Administration" description="Loading platform overview..." />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-ink-400" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader title="Platform Administration" description="Could not load platform data" />
        <EmptyState
          icon={<Database className="h-8 w-8" />}
          title="Unable to Load Data"
          description={error}
          action={{ label: 'Retry', onClick: fetchData }}
        />
      </div>
    );
  }

  const d = data!;

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Dashboard', href: '/dashboard' },
        { label: 'Platform Administration' },
      ]} />
      <PageHeader
        title="Platform Administration"
        description="Overview of all tenants and system-wide metrics"
      >
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="primary" size="sm" asChild>
            <Link href="/dashboard/platform/tenants">
              <Globe className="h-4 w-4" /> All Tenants
            </Link>
          </Button>
        </div>
      </PageHeader>

      {/* Tenant Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Active Tenants"
          value={String(d.tenants.active)}
          trend={{ value: `${d.tenants.active} of ${d.tenants.total} active`, positive: true }}
          icon={<Globe className="h-5 w-5" />}
        />
        <StatCard
          title="Suspended"
          value={String(d.tenants.suspended)}
          trend={{ value: `${d.tenants.suspended} suspended`, positive: d.tenants.suspended === 0 }}
          icon={<XCircle className="h-5 w-5" />}
        />
        <StatCard
          title="Total Members"
          value={String(d.totalMembers)}
          trend={{ value: 'Across all tenants', positive: true }}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Total Tenants"
          value={String(d.tenants.total)}
          trend={{ value: `${d.tenants.inactive} inactive`, positive: d.tenants.inactive === 0 }}
          icon={<Activity className="h-5 w-5" />}
        />
      </div>

      {/* Usage Metrics */}
      <Card>
        <CardHeader>
          <CardTitle>System Usage</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-brand-50">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                <Truck className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-ink-950">{d.vehicles.total}</p>
                <p className="text-xs text-ink-500">
                  {d.vehicles.active} available · {d.vehicles.maintenance} in maintenance
                </p>
                <p className="text-xs text-ink-500">Total Vehicles</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-50">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
                <FileText className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-ink-950">{d.requests.totalRequests}</p>
                <p className="text-xs text-ink-500">Transport Requests</p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-green-100 text-green-700">
                <Gauge className="h-6 w-6" />
              </div>
              <div>
                <p className="text-2xl font-bold text-ink-950">{d.trips.total}</p>
                <p className="text-xs text-ink-500">
                  {d.trips.active} active
                </p>
                <p className="text-xs text-ink-500">Total Trips</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Environment Health */}
      <Card>
        <CardHeader>
          <CardTitle>Environment Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
              {d.envHealth.database
                ? <CheckCircle2 className="h-5 w-5 text-status-success-text shrink-0" />
                : <AlertTriangle className="h-5 w-5 text-status-error-text shrink-0" />}
              <div>
                <p className="text-sm font-medium text-ink-950">Database</p>
                <p className="text-xs text-ink-500">
                  {d.envHealth.database ? 'Connected' : 'Not configured'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
              {d.envHealth.backgroundJobs
                ? <CheckCircle2 className="h-5 w-5 text-status-success-text shrink-0" />
                : <AlertTriangle className="h-5 w-5 text-status-pending-text shrink-0" />}
              <div>
                <p className="text-sm font-medium text-ink-950">Background Jobs</p>
                <p className="text-xs text-ink-500">
                  {d.envHealth.backgroundJobs ? 'Connected' : 'Not configured (optional)'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
              {d.envHealth.errorMonitoring
                ? <CheckCircle2 className="h-5 w-5 text-status-success-text shrink-0" />
                : <AlertTriangle className="h-5 w-5 text-status-pending-text shrink-0" />}
              <div>
                <p className="text-sm font-medium text-ink-950">Error Monitoring</p>
                <p className="text-xs text-ink-500">
                  {d.envHealth.errorMonitoring ? 'Sentry connected' : 'Not configured (optional)'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border">
              {d.envHealth.email
                ? <CheckCircle2 className="h-5 w-5 text-status-success-text shrink-0" />
                : <AlertTriangle className="h-5 w-5 text-status-pending-text shrink-0" />}
              <div>
                <p className="text-sm font-medium text-ink-950">Email</p>
                <p className="text-xs text-ink-500">
                  {d.envHealth.email ? 'Configured' : 'Not configured (optional)'}
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Tenants */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Tenants</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {d.recentTenants.length === 0 ? (
            <div className="px-5 pb-4">
              <p className="text-sm text-ink-500">No tenants registered yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {d.recentTenants.map((t) => (
                <Link
                  key={t.id}
                  href={`/dashboard/platform/tenants/${t.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-canvas/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Building2 className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink-950">{t.name}</p>
                      <p className="text-xs text-ink-500">{t.code} · {t.type.replace(/_/g, ' ')}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={
                      t.status === 'active' ? 'success' :
                      t.status === 'suspended' ? 'error' : 'cancelled'
                    }>
                      {t.status}
                    </Badge>
                    <span className="text-xs text-ink-400">
                      <Clock className="inline h-3 w-3 mr-1" />
                      {t.createdAt ? formatDate(t.createdAt) : ''}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
        <div className="border-t border-border px-5 py-3">
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/platform/tenants">
              View All Tenants
            </Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
