'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';

interface TenantResetRequest {
  id: string;
  scope: string;
  reason: string;
  status: string;
  backupCreated: boolean;
  backupRecordCount: number | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  failureReason: string | null;
  validationResults: { dryRunSummary?: { total?: number } } | null;
  results: { dryRunSummary?: { total?: number } } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS: Record<string, { label: string; variant: BadgeProps['variant']; detail: string }> = {
  draft: { label: 'Draft', variant: 'default', detail: 'Not yet submitted.' },
  pending_review: {
    label: 'Awaiting platform review',
    variant: 'warning',
    detail: 'A Platform Administrator will review the reason and impact.',
  },
  approved: {
    label: 'Approved',
    variant: 'info',
    detail: 'The Platform Administrator is preparing the dry run and recovery point.',
  },
  in_progress: {
    label: 'Reset in progress',
    variant: 'warning',
    detail: 'Do not create new operational records until completion.',
  },
  completed: {
    label: 'Completed',
    variant: 'success',
    detail: 'Operational data was reset successfully.',
  },
  rejected: { label: 'Declined', variant: 'error', detail: 'Review the platform response below.' },
  failed: {
    label: 'Needs attention',
    variant: 'error',
    detail: 'The Platform Administrator retains the recovery point and can investigate.',
  },
  cancelled: {
    label: 'Cancelled',
    variant: 'default',
    detail: 'The request was withdrawn before approval.',
  },
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NA', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function TenantDataResetPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [requests, setRequests] = useState<TenantResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [reason, setReason] = useState('');
  const [acknowledgement, setAcknowledgement] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/data-reset', { cache: 'no-store' });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not load reset requests');
      setRequests(json.data?.requests ?? []);
    } catch (error) {
      toast({
        title: 'Could not load reset requests',
        description: error instanceof Error ? error.message : 'Load failed',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openRequest = useMemo(
    () =>
      requests.find((request) =>
        ['draft', 'pending_review', 'approved', 'in_progress'].includes(request.status),
      ),
    [requests],
  );

  const submit = async () => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/data-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, acknowledgement }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not submit reset request');
      setReason('');
      setAcknowledgement('');
      toast({
        title: 'Reset request sent',
        description: 'Platform Administrators have been notified for review.',
        variant: 'success',
      });
      await load();
    } catch (error) {
      toast({
        title: 'Request not sent',
        description: error instanceof Error ? error.message : 'Submission failed',
        variant: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const cancelRequest = (request: TenantResetRequest) => {
    confirm({
      title: 'Cancel reset request?',
      description:
        'The Platform Administrator will no longer process this request. No operational data will be changed.',
      confirmLabel: 'Cancel request',
      variant: 'destructive',
      onConfirm: async () => {
        setSubmitting(true);
        try {
          const response = await fetch('/api/admin/data-reset', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: request.id, action: 'cancel' }),
          });
          const json = await response.json();
          if (!response.ok) throw new Error(json.error || 'Could not cancel request');
          toast({ title: 'Reset request cancelled', variant: 'success' });
          await load();
        } catch (error) {
          toast({
            title: 'Cancellation failed',
            description: error instanceof Error ? error.message : 'Try again',
            variant: 'error',
          });
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Tenant Administration' }, { label: 'Operational Data Reset' }]}
      />
      <PageHeader
        title="Operational Data Reset"
        description="Request a controlled operational reset from the Platform Administrator and follow its progress."
      >
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </PageHeader>

      <section className="border-status-warning-text/20 bg-status-warning-bg/20 rounded-[10px] border p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-status-warning-text mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-ink-950 text-sm font-semibold">
              A reset is reviewed and performed by the platform team
            </p>
            <p className="text-ink-600 mt-1 text-sm leading-relaxed">
              Submitting this form does not delete anything. A Platform Administrator must review
              the request, calculate the exact impact, approve it, create and verify a recovery
              point, then type the tenant-specific execution confirmation.
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Request a reset</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="border-brand-200 bg-brand-50/40 dark:bg-brand-950/20 rounded-[8px] border p-4">
              <p className="text-ink-950 text-sm font-semibold">Operational reset preset</p>
              <p className="text-ink-600 mt-1 text-xs leading-relaxed">
                Clears requests, workflow instances, allocations, trips, trip logs, fuel
                transactions, inspections, operational documents, defects and their related
                notifications.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {[
                  'Tenant & branding',
                  'Users & roles',
                  'Staff',
                  'Vehicles',
                  'Programmes',
                  'Organisation structure',
                  'Workflow setup',
                  'Audit history',
                ].map((item) => (
                  <Badge key={item} variant="success" size="sm">
                    Keeps {item}
                  </Badge>
                ))}
              </div>
            </div>
            {openRequest ? (
              <div className="border-status-info-text/20 bg-status-info-bg/20 rounded-[8px] border p-4">
                <p className="text-ink-950 text-sm font-semibold">A request is already open</p>
                <p className="text-ink-600 mt-1 text-xs">
                  Track its status in the history panel. Only one reset request can be active at a
                  time.
                </p>
              </div>
            ) : (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-reason">Operational reason</Label>
                  <Textarea
                    id="reset-reason"
                    rows={5}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Explain why the organisation needs a clean operational starting point, what test or historical data should be removed, and when the reset should happen."
                  />
                  <p className="text-ink-400 text-xs">
                    Minimum 20 characters. This becomes part of the audit record.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-acknowledgement">Type REQUEST RESET</Label>
                  <Input
                    id="reset-acknowledgement"
                    value={acknowledgement}
                    onChange={(event) => setAcknowledgement(event.target.value)}
                    autoComplete="off"
                  />
                </div>
                <Button
                  className="w-full"
                  onClick={() => void submit()}
                  loading={submitting}
                  disabled={reason.trim().length < 20 || acknowledgement !== 'REQUEST RESET'}
                >
                  <Database className="h-4 w-4" /> Send to Platform Administrator
                </Button>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Request history</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-ink-500 flex min-h-48 items-center justify-center gap-2 text-sm">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading requests…
              </div>
            ) : requests.length === 0 ? (
              <EmptyState
                icon={<RotateCcw className="h-6 w-6" />}
                title="No reset requests"
                description="Your organisation has not requested an operational reset."
              />
            ) : (
              <div className="space-y-3">
                {requests.map((request) => {
                  const status = STATUS[request.status] ?? {
                    label: request.status,
                    variant: 'default' as const,
                    detail: '',
                  };
                  const impact =
                    request.results?.dryRunSummary?.total ??
                    request.validationResults?.dryRunSummary?.total;
                  return (
                    <article key={request.id} className="border-border rounded-[8px] border p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {request.backupCreated && (
                            <Badge variant="success" size="sm">
                              Recovery point ready
                            </Badge>
                          )}
                        </div>
                        <span className="text-ink-400 text-xs">
                          {formatDate(request.createdAt)}
                        </span>
                      </div>
                      <p className="text-ink-700 mt-3 text-sm">{request.reason}</p>
                      <p className="text-ink-500 mt-2 text-xs">
                        {status.detail}
                        {typeof impact === 'number' ? ` Impact: ${impact} operational rows.` : ''}
                      </p>
                      {(request.reviewNotes || request.failureReason) && (
                        <div className="bg-muted/60 mt-3 rounded-[8px] p-3">
                          <p className="text-ink-700 text-xs font-semibold">Platform response</p>
                          <p className="text-ink-600 mt-1 text-xs">
                            {request.reviewNotes || request.failureReason}
                          </p>
                        </div>
                      )}
                      <div className="text-ink-400 mt-3 flex flex-wrap items-center gap-3 text-xs">
                        {request.status === 'completed' ? (
                          <>
                            <CheckCircle2 className="text-status-success-text h-4 w-4" /> Completed{' '}
                            {formatDate(request.completedAt)}
                          </>
                        ) : request.status === 'rejected' ? (
                          <>
                            <XCircle className="text-status-error-text h-4 w-4" /> Reviewed{' '}
                            {formatDate(request.reviewedAt)}
                          </>
                        ) : (
                          <>
                            <Clock3 className="h-4 w-4" /> Updated {formatDate(request.updatedAt)}
                          </>
                        )}
                        {['draft', 'pending_review'].includes(request.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-status-error-text ml-auto"
                            onClick={() => void cancelRequest(request)}
                            loading={submitting}
                          >
                            Cancel request
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      {confirmDialog}
    </div>
  );
}
