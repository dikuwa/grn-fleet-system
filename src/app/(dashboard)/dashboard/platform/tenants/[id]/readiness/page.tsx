'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/lib/use-toast';

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
  const { toast } = useToast();
  const [tenant, setTenant] = useState<TenantReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [returning, setReturning] = useState(false);
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
    const timeoutId = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [load]);

  const returnForChanges = useCallback(async () => {
    if (!tenant || tenant.lifecycleStatus !== 'PENDING_PLATFORM_REVIEW') return;
    setReturning(true);
    setError('');
    try {
      const response = await fetch(`/api/platform/tenants/${id}/return-for-changes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: tenant.readiness.blockerCount > 0
            ? 'Returned to Tenant Administrator to resolve activation readiness blockers'
            : 'Returned to Tenant Administrator for requested setup changes',
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not return tenant for changes');
      toast({
        title: 'Returned for changes',
        description: 'The Tenant Administrator can access setup again, make the required changes, and resubmit for Platform Review.',
        variant: 'success',
      });
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not return tenant for changes';
      setError(message);
      toast({ title: 'Return failed', description: message, variant: 'error' });
    } finally {
      setReturning(false);
    }
  }, [id, load, tenant, toast]);

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
  const pendingReview = tenant.lifecycleStatus === 'PENDING_PLATFORM_REVIEW';

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
        <Button variant="secondary" size="sm" disabled={returning} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Recheck
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${readiness.readyForActivation ? 'bg-status-success-bg text-status-success-text' : 'bg-status-warning-bg text-status-warning-text'}`}>
                {readiness.readyForActivation ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-ink-950">
                    {readiness.readyForActivation ? 'Ready for activation' : 'Activation blockers remain'}
                  </h2>
                  {pendingReview && <Badge variant="pending" size="sm">Platform Review</Badge>}
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-5 text-ink-500">
                  {readiness.readyForActivation
                    ? 'All universal operational prerequisites are satisfied. Optional tenant-specific setup may continue after activation.'
                    : `${readiness.blockerCount} required item${readiness.blockerCount === 1 ? '' : 's'} must be resolved before this tenant can be moved to Ready for Activation or Active.`}
                </p>
                {pendingReview && !readiness.readyForActivation && (
                  <p className="mt-2 text-xs leading-5 text-ink-600">
                    Return the tenant for changes so its Tenant Administrator can resolve the required items and submit it again. This does not mark onboarding as failed.
                  </p>
                )}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Badge variant={readiness.blockerCount ? 'error' : 'success'} size="sm">
                {readiness.blockerCount} blockers
              </Badge>
              <Badge variant={readiness.warningCount ? 'warning' : 'default'} size="sm">
                {readiness.warningCount} optional warnings
              </Badge>
            </div>
          </div>

          {pendingReview && (
            <div className="border-border mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-ink-500">
                {readiness.readyForActivation
                  ? 'If the checklist is correct, continue the normal activation review. Return only when the tenant must change its setup.'
                  : 'Returning reopens Tenant Admin setup while preserving the tenant, subscription, invitation history and existing configuration.'}
              </p>
              <Button variant="secondary" size="sm" disabled={returning} onClick={() => void returnForChanges()} className="shrink-0">
                {returning ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RotateCcw className="h-4 w-4" />}
                Return for Changes
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-[8px] border border-status-error-border bg-status-error-bg px-3 py-2.5 text-sm text-status-error-text" role="alert">
          {error}
        </div>
      )}

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
            Vehicles, drivers, departments, regions, BlueFuel/Fleet Payments, employee request access and tenant branding may be configured according to each tenant&apos;s operating model. The platform does not force those optional choices simply to activate a tenant.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
