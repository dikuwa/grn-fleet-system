'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/lib/use-toast';

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  category: 'required' | 'recommended' | 'optional';
  ready: boolean;
  href: string;
  actionLabel: string;
}

interface OperationalSetupData {
  tenant: {
    id: string;
    name: string;
    lifecycleStatus: string;
    reviewFeedback: string | null;
  };
  counts: {
    offices: number;
    departments: number;
    staff: number;
    drivers: number;
    vehicles: number;
    workflows: number;
    inspectionTemplates: number;
    fleetPaymentProviders: number;
  };
  requiredRemaining: number;
  canSubmitForReview: boolean;
  checklist: ChecklistItem[];
}

function formatLifecycle(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function OperationalSetupPage() {
  const { toast } = useToast();
  const [data, setData] = useState<OperationalSetupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/setup/operational-readiness', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load operational setup');
      setData(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load operational setup');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitForReview = useCallback(async () => {
    if (!data?.canSubmitForReview) return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/setup/operational-readiness', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit_for_review' }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(json.error || 'Could not submit operational setup for review');
      setData((current) => current ? {
        ...current,
        tenant: { ...current.tenant, lifecycleStatus: json.data.lifecycleStatus, reviewFeedback: null },
        canSubmitForReview: false,
      } : current);
      toast({
        title: 'Submitted for platform review',
        description: 'Required tenant setup is complete. Tenant access is now paused while the Platform Administrator performs the final activation review.',
        variant: 'success',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not submit operational setup for review';
      setError(message);
      toast({ title: 'Submission blocked', description: message, variant: 'error' });
    } finally {
      setSubmitting(false);
    }
  }, [data?.canSubmitForReview, toast]);

  const requiredReady = data?.requiredRemaining === 0;
  const submitted = data?.tenant.lifecycleStatus === 'PENDING_PLATFORM_REVIEW';
  const completedRecommended = useMemo(
    () => data?.checklist.filter((item) => item.category === 'recommended' && item.ready).length ?? 0,
    [data],
  );
  const recommendedTotal = useMemo(
    () => data?.checklist.filter((item) => item.category === 'recommended').length ?? 0,
    [data],
  );

  if (loading) {
    return (
      <div className="text-ink-500 flex min-h-[45dvh] items-center justify-center gap-2 text-sm" role="status">
        <Loader2 className="text-brand-700 h-5 w-5 animate-spin motion-reduce:animate-none" />
        Checking operational setup…
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Workspace Setup', href: '/dashboard/setup' }, { label: 'Operational Setup' }]} />
        <EmptyState
          icon={<Settings2 className="h-6 w-6" />}
          title="Operational setup unavailable"
          description={error || 'The setup status could not be loaded.'}
          action={{ label: 'Retry', onClick: () => void load() }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Workspace Setup', href: '/dashboard/setup' },
          { label: 'Operational Setup' },
        ]}
      />

      <PageHeader
        title="Operational Setup"
        description="Finish only the configuration needed for real transport operations."
      >
        <Button variant="secondary" size="sm" disabled={submitting} onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Recheck
        </Button>
      </PageHeader>

      {data.tenant.reviewFeedback && (
        <div className="border-status-info-text/25 bg-status-info-bg/25 rounded-[8px] border px-4 py-3">
          <div className="flex items-start gap-3">
            <MessageSquareText className="text-status-info-text mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="text-ink-950 text-sm font-semibold">Platform review feedback</p>
              <p className="text-ink-600 mt-1 text-sm leading-6">{data.tenant.reviewFeedback}</p>
              <p className="text-ink-500 mt-1 text-xs">Resolve the relevant setup item below, recheck, then submit for Platform Review again.</p>
            </div>
          </div>
        </div>
      )}

      <Card>
        <CardContent className="py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${submitted || requiredReady ? 'bg-status-success-bg text-status-success-text' : 'bg-status-warning-bg text-status-warning-text'}`}>
                {submitted || requiredReady ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-ink-950 text-sm font-semibold">
                  {submitted
                    ? 'Submitted for platform review'
                    : requiredReady
                      ? 'Required tenant setup is ready'
                      : 'Required tenant setup remains'}
                </h2>
                <p className="text-ink-500 mt-1 text-xs leading-5">
                  {submitted
                    ? 'No further onboarding action is required from the Tenant Administrator unless the Platform Administrator returns the setup for changes.'
                    : requiredReady
                      ? 'Initial setup and an approval workflow are in place. You can submit this tenant for the final Platform review.'
                      : `${data.requiredRemaining} required item${data.requiredRemaining === 1 ? '' : 's'} still need attention. Recommended and optional items can be completed later.`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant={requiredReady ? 'success' : 'warning'} size="sm">
                {data.requiredRemaining} required remaining
              </Badge>
              <Badge variant="default" size="sm">
                {completedRecommended}/{recommendedTotal} recommended ready
              </Badge>
              <Badge variant="info" size="sm">{formatLifecycle(data.tenant.lifecycleStatus)}</Badge>
            </div>
          </div>

          {data.canSubmitForReview && (
            <div className="border-border mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-ink-500 text-xs leading-5">
                Submitting pauses tenant access while Platform Review is in progress. The Platform Administrator can activate the tenant or return it for changes.
              </p>
              <Button variant="primary" size="sm" disabled={submitting} onClick={() => void submitForReview()} className="shrink-0">
                {submitting ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <ShieldCheck className="h-4 w-4" />}
                Submit for Platform Review
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <div className="border-status-error-border bg-status-error-bg text-status-error-text rounded-[8px] border px-3 py-2.5 text-sm" role="alert">
          {error}
        </div>
      )}

      <div className="grid gap-3">
        {data.checklist.map((item) => {
          const optional = item.category === 'optional';
          return (
            <Card key={item.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  {item.ready ? (
                    <CheckCircle2 className="text-status-success-text mt-0.5 h-5 w-5 shrink-0" />
                  ) : optional ? (
                    <CircleDashed className="text-ink-400 mt-0.5 h-5 w-5 shrink-0" />
                  ) : (
                    <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${item.category === 'required' ? 'text-status-error-text' : 'text-status-warning-text'}`} />
                  )}
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-ink-950 text-sm font-medium">{item.label}</p>
                      <Badge
                        variant={item.category === 'required' ? 'error' : item.category === 'recommended' ? 'warning' : 'default'}
                        size="sm"
                      >
                        {item.category === 'required' ? 'Required' : item.category === 'recommended' ? 'Recommended' : 'Optional'}
                      </Badge>
                      {item.ready && <Badge variant="success" size="sm">Ready</Badge>}
                    </div>
                    <p className="text-ink-500 mt-1 text-xs leading-5">{item.description}</p>
                  </div>
                </div>
                <Button variant="secondary" size="sm" asChild className="shrink-0 self-start sm:self-auto">
                  <Link href={item.href}>{item.ready ? 'Review' : item.actionLabel}</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardContent className="py-5">
          <p className="text-ink-600 text-sm leading-6">
            <strong className="text-ink-950">Required means required for activation.</strong> Recommended items help the tenant become useful faster, while optional items should only be enabled when this organisation actually needs them. You can return to this page and recheck at any time during setup.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
