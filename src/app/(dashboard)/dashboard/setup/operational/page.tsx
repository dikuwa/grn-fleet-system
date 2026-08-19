'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Loader2,
  RefreshCw,
  Settings2,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';

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
  };
  counts: {
    offices: number;
    departments: number;
    staff: number;
    drivers: number;
    vehicles: number;
    workflows: number;
  };
  requiredRemaining: number;
  checklist: ChecklistItem[];
}

function formatLifecycle(value: string) {
  return value.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function OperationalSetupPage() {
  const [data, setData] = useState<OperationalSetupData | null>(null);
  const [loading, setLoading] = useState(true);
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

  const requiredReady = data?.requiredRemaining === 0;
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
        description="Prepare the workspace for real transport operations without turning onboarding into a long wizard."
      >
        <Button variant="secondary" size="sm" onClick={() => void load()}>
          <RefreshCw className="h-4 w-4" /> Recheck
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${requiredReady ? 'bg-status-success-bg text-status-success-text' : 'bg-status-warning-bg text-status-warning-text'}`}>
                {requiredReady ? <CheckCircle2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
              </div>
              <div>
                <h2 className="text-ink-950 text-sm font-semibold">
                  {requiredReady ? 'Tenant-managed activation requirements are ready' : 'Required tenant setup remains'}
                </h2>
                <p className="text-ink-500 mt-1 text-xs leading-5">
                  {requiredReady
                    ? 'Initial setup and an operational approval workflow are in place. Platform review still controls final activation.'
                    : `${data.requiredRemaining} required tenant-managed item${data.requiredRemaining === 1 ? '' : 's'} still need attention before platform activation.`}
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
        </CardContent>
      </Card>

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
            <strong className="text-ink-950">Keep onboarding practical:</strong> vehicles, drivers, departments, external request access and Fleet Payments are shown here because they often matter operationally, but they are not all universal activation blockers. Configure only what this organisation actually uses.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
