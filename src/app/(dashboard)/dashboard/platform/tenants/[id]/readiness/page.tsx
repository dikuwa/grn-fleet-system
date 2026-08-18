'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

interface ReadinessCheck {
  id: string;
  label: string;
  description: string;
  severity: 'blocker' | 'warning';
  ready: boolean;
  actionHref?: string;
  actionLabel?: string;
}

interface TenantReadinessData {
  id: string;
  name: string;
  code: string;
  lifecycleStatus: string;
  readiness: {
    readyForActivation: boolean;
    blockerCount: number;
    warningCount: number;
    checks: ReadinessCheck[];
  };
}

export default function PlatformTenantReadinessPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tenant, setTenant] = useState<TenantReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`/api/platform/tenants/${id}`, { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load activation readiness');
      setTenant(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load activation readiness');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-ink-500" role="status">
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> Checking tenant readiness…
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Tenants', href: '/dashboard/platform/tenants' }, { label: 'Activation Readiness' }]} />
        <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Readiness unavailable" description={error || 'The tenant could not be loaded.'} />
      </div>
    );
  }

  const readiness = tenant.readiness;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Platform', href: '/dashboard/platform' },
          { label: 'Tenants', href: '/dashboard/platform/tenants' },
          { label: tenant.name, href: `/dashboard/platform/tenants/${id}` },
          { label: 'Activation Readiness' },
        ]}
      />
      <PageHeader
        title="Activation Readiness"
        description={`${tenant.name} · ${tenant.code}`}
      >
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Recheck
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${readiness.readyForActivation ? 'bg-status-success-bg text-status-success-text' : 'bg-status-warning-bg text-status-warning-text'}`}>
                {readiness.readyForActivation ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-sm font-semibold text-ink-950">
                  {readiness.readyForActivation ? 'Ready for activation' : 'Activation blockers remain'}
                </h2>
                <p className="mt-1 text-xs leading-5 text-ink-500">
                  {readiness.readyForActivation
                    ? 'All universal operational prerequisites are satisfied. Optional tenant-specific setup may continue after activation.'
                    : `${readiness.blockerCount} required item${readiness.blockerCount === 1 ? '' : 's'} must be resolved before this tenant can be moved to Ready for Activation or Active.`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={readiness.blockerCount ? 'error' : 'success'} size="sm">
                {readiness.blockerCount} blockers
              </Badge>
              <Badge variant={readiness.warningCount ? 'warning' : 'default'} size="sm">
                {readiness.warningCount} optional warnings
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {readiness.checks.map((check) => (
          <Card key={check.id}>
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                {check.ready ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-status-success-text" />
                ) : check.severity === 'blocker' ? (
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-status-error-text" />
                ) : (
                  <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-status-warning-text" />
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink-950">{check.label}</p>
                    {!check.ready && (
                      <Badge variant={check.severity === 'blocker' ? 'error' : 'warning'} size="sm">
                        {check.severity === 'blocker' ? 'Required' : 'Recommended'}
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-ink-500">{check.description}</p>
                </div>
              </div>
              {!check.ready && check.actionHref && check.actionLabel && (
                <Button variant="secondary" size="sm" asChild className="shrink-0">
                  <Link href={check.actionHref}>{check.actionLabel}</Link>
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What is intentionally not an activation blocker?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-ink-600">
            Vehicles, drivers, departments, regions, BlueFuel/Fleet Payments, public employee request access and tenant branding may be configured according to the organisation's operating model. The platform does not force those optional choices simply to activate a tenant.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
