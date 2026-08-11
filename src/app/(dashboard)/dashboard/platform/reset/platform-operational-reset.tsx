'use client';

import { useState } from 'react';
import { Archive, Loader2, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { PLATFORM_EXECUTION_RESET_PHRASE } from '@/lib/reset-workflow';
import { useToast } from '@/lib/use-toast';

interface PlatformResetPlan {
  counts: {
    enquiries: number;
    demoRequests: number;
    notifications: number;
    notificationDeliveries: number;
    notificationReads: number;
    notificationDismissals: number;
    total: number;
  };
  fingerprint: string;
  plannedAt: string;
  preserved: string[];
}

interface RecoveryPoint {
  id: string;
  recordCount: number | null;
  sizeBytes: number | null;
}

async function readResponse(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Platform reset operation failed');
  return body;
}

function formatBytes(value: number | null) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  return `${(value / 1024).toFixed(1)} KB`;
}

export function PlatformOperationalReset() {
  const [plan, setPlan] = useState<PlatformResetPlan | null>(null);
  const [recoveryPoint, setRecoveryPoint] = useState<RecoveryPoint | null>(null);
  const [working, setWorking] = useState<'preview' | 'backup' | 'execute' | null>(null);
  const { confirm, dialog } = useConfirm();
  const { toast } = useToast();

  const preview = async () => {
    setWorking('preview');
    try {
      const response = await fetch('/api/platform/reset/platform', { cache: 'no-store' });
      const body = await readResponse(response);
      setPlan(body.data);
      setRecoveryPoint(null);
    } catch (error) {
      toast({
        title: 'Platform preview failed',
        description: error instanceof Error ? error.message : 'Could not preview platform data',
        variant: 'error',
      });
    } finally {
      setWorking(null);
    }
  };

  const createRecoveryPoint = async () => {
    if (!plan) return;
    setWorking('backup');
    try {
      const response = await fetch('/api/platform/reset/platform', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backup', fingerprint: plan.fingerprint }),
      });
      const body = await readResponse(response);
      setRecoveryPoint(body.data);
      toast({
        title: 'Protected recovery point ready',
        description: 'The platform operational archive passed storage verification.',
        variant: 'success',
      });
    } catch (error) {
      setRecoveryPoint(null);
      toast({
        title: 'Recovery point failed',
        description: error instanceof Error ? error.message : 'Could not protect platform data',
        variant: 'error',
      });
    } finally {
      setWorking(null);
    }
  };

  const requestExecution = () => {
    if (!plan || !recoveryPoint) return;
    confirm({
      title: 'Reset platform operational data?',
      description: `This will permanently remove ${plan.counts.total} disposable platform operational records. Tenant data, platform access, billing, configuration, audit history and the protected recovery point remain intact.`,
      confirmLabel: 'Reset platform data',
      variant: 'destructive',
      requireTypedConfirm: PLATFORM_EXECUTION_RESET_PHRASE,
      onConfirm: async () => {
        setWorking('execute');
        try {
          const response = await fetch('/api/platform/reset/platform', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'execute',
              fingerprint: plan.fingerprint,
              backupId: recoveryPoint.id,
              confirmationPhrase: PLATFORM_EXECUTION_RESET_PHRASE,
            }),
          });
          const body = await readResponse(response);
          toast({
            title: 'Platform operational reset complete',
            description: `${body.data.removed.total} records were removed. Protected and tenant data were preserved.`,
            variant: 'success',
          });
          setPlan(null);
          setRecoveryPoint(null);
        } catch (error) {
          toast({
            title: 'Platform reset blocked or failed',
            description: error instanceof Error ? error.message : 'Platform reset did not run',
            variant: 'error',
          });
        } finally {
          setWorking(null);
        }
      },
    });
  };

  return (
    <section className="border-status-error-text/25 bg-surface rounded-[10px] border">
      <div className="border-border flex flex-col gap-4 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Trash2 className="text-status-error-text mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="text-ink-950 text-sm font-semibold">Platform operational reset</h2>
            <p className="text-ink-600 mt-1 max-w-3xl text-xs leading-relaxed">
              Clears public enquiries, unconverted demo requests and their Platform Admin
              notifications. It never resets tenants and never deletes platform users, billing,
              configuration, CMS content, backups or audit history.
            </p>
            <p className="text-ink-500 mt-2 max-w-3xl text-xs leading-relaxed">
              Dashboard effect: Demo Requests and Public Enquiries return to zero. Tenant requests
              and trips require a tenant operational reset; memberships, fleet vehicles and vehicle
              maintenance statuses are protected and do not reset.
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void preview()}
          disabled={working !== null}
        >
          {working === 'preview' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {plan ? 'Refresh impact' : 'Preview impact'}
        </Button>
      </div>

      {plan ? (
        <div className="space-y-4 p-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Public enquiries', plan.counts.enquiries],
              ['Unconverted demos', plan.counts.demoRequests],
              ['Notifications', plan.counts.notifications],
              ['Total rows', plan.counts.total],
            ].map(([label, value]) => (
              <div key={String(label)} className="border-border rounded-[8px] border p-3">
                <p className="text-ink-950 text-xl font-semibold tabular-nums">{Number(value)}</p>
                <p className="text-ink-500 mt-1 text-xs">{String(label)}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="text-ink-700 mb-2 text-xs font-medium">Always preserved</p>
            <div className="flex flex-wrap gap-2">
              {plan.preserved.map((item) => (
                <Badge key={item} variant="success" size="sm">
                  <ShieldCheck className="h-3 w-3" /> {item}
                </Badge>
              ))}
            </div>
          </div>

          <div className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs">
              {recoveryPoint ? (
                <p className="text-status-success-text flex items-center gap-1.5 font-medium">
                  <Archive className="h-4 w-4" /> Protected recovery point ready ·{' '}
                  {recoveryPoint.recordCount ?? 0} rows · {formatBytes(recoveryPoint.sizeBytes)}
                </p>
              ) : (
                <p className="text-ink-500">
                  A verified protected archive is required before execution.
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void createRecoveryPoint()}
                loading={working === 'backup'}
                disabled={working !== null}
              >
                <Archive className="h-4 w-4" /> Create recovery point
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={requestExecution}
                loading={working === 'execute'}
                disabled={!recoveryPoint || working !== null}
              >
                <Trash2 className="h-4 w-4" /> Reset platform operations
              </Button>
            </div>
          </div>
          {recoveryPoint && (
            <p className="text-ink-500 text-right text-xs">
              Final confirmation requires{' '}
              <strong className="text-status-error-text">
                &quot;{PLATFORM_EXECUTION_RESET_PHRASE}&quot;
              </strong>
            </p>
          )}
        </div>
      ) : (
        <p className="text-ink-500 p-4 text-xs">
          Run the read-only preview to see the exact platform records currently eligible for reset.
        </p>
      )}
      {dialog}
    </section>
  );
}
