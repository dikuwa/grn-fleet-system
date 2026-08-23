'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  Clock3,
  Database,
  Loader2,
  PlayCircle,
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
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Input, Label, Textarea } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';
import { TENANT_RESET_REQUEST_PHRASE } from '@/lib/reset-workflow';
import { ResetSpecBuilder, type ResetBuilderValue } from '@/components/reset/reset-spec-builder';
import {
  RESET_ALWAYS_PROTECTED,
  RESET_CATEGORY_CATALOG,
  type ResetSpec,
} from '@/lib/reset-catalog';

interface TenantResetRequest {
  id: string;
  scope: string;
  reason: string;
  status: string;
  confirmationPhrase: string | null;
  tenantExecutable?: boolean;
  platformExecutionRequired?: boolean;
  backupCreated: boolean;
  rollbackPossible: boolean;
  backupRecordCount: number | null;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
  failureReason: string | null;
  validationResults: {
    dryRunSummary?: { total?: number };
    protected?: string[];
    plannedAt?: string;
  } | null;
  results: { dryRunSummary?: { total?: number } } | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: { resetSpec?: ResetSpec } | null;
  approvalExpired?: boolean;
  approvalExpiresAt?: string | null;
}

const STATUS: Record<string, { label: string; variant: BadgeProps['variant']; detail: string }> = {
  draft: { label: 'Draft', variant: 'default', detail: 'Not yet submitted.' },
  pending_review: {
    label: 'Awaiting platform review',
    variant: 'warning',
    detail: 'Platform Administration is reviewing the requested scope and impact.',
  },
  approved: {
    label: 'Approved',
    variant: 'info',
    detail: 'The request is approved. Execution becomes available after recovery verification.',
  },
  in_progress: {
    label: 'Reset in progress',
    variant: 'warning',
    detail: 'Do not create new operational records until completion.',
  },
  completed: {
    label: 'Completed',
    variant: 'success',
    detail: 'The approved reset plan completed successfully.',
  },
  rejected: { label: 'Declined', variant: 'error', detail: 'Review the platform response below.' },
  failed: {
    label: 'Needs attention',
    variant: 'error',
    detail: 'The verified recovery point remains available while the failure is investigated.',
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
  const searchParams = useSearchParams();
  const highlightedRequestId = searchParams.get('request');
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [requests, setRequests] = useState<TenantResetRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [executingId, setExecutingId] = useState<string | null>(null);
  const [requestView, setRequestView] = useState<'current' | 'history'>('current');
  const [executionInputs, setExecutionInputs] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [acknowledgement, setAcknowledgement] = useState('');
  const [resetBuilder, setResetBuilder] = useState<ResetBuilderValue>({
    preset: 'operational',
    categories: ['operations'],
    cutoff: '',
  });

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

  useEffect(() => {
    if (loading || !highlightedRequestId) return;
    document
      .getElementById(`reset-request-${highlightedRequestId}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [highlightedRequestId, loading, requests]);

  const openRequest = useMemo(
    () =>
      requests.find(
        (item) =>
          ['draft', 'pending_review', 'approved', 'in_progress'].includes(item.status) &&
          !(item.status === 'approved' && item.approvalExpired),
      ),
    [requests],
  );
  const readyRequest = useMemo(
    () => requests.find((item) => item.tenantExecutable && item.confirmationPhrase),
    [requests],
  );
  const expiredApproval = useMemo(
    () => requests.find((item) => item.status === 'approved' && item.approvalExpired),
    [requests],
  );
  const currentRequest = readyRequest ?? openRequest;
  const recentCompletedId = requests.find((item) => item.status === 'completed')?.id;
  const currentRequests = requests.filter(
    (item) =>
      ['draft', 'pending_review', 'approved', 'in_progress', 'failed'].includes(item.status) ||
      item.id === recentCompletedId,
  );
  const historicalRequests = requests.filter((item) => !currentRequests.includes(item));
  const visibleRequests = requestView === 'current' ? currentRequests : historicalRequests;

  const showRequest = (id: string) => {
    document
      .getElementById(`reset-request-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const response = await fetch('/api/admin/data-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          acknowledgement,
          resetSpec: {
            preset: resetBuilder.preset,
            categories: resetBuilder.categories,
            cutoff: resetBuilder.cutoff || null,
            target: 'tenant',
          },
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Could not submit reset request');
      setReason('');
      setAcknowledgement('');
      toast({
        title: 'Reset request sent',
        description: 'Platform Administration has been notified for impact review and approval.',
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

  const cancelRequest = (item: TenantResetRequest) => {
    confirm({
      title: 'Cancel reset request?',
      description:
        'Platform Administration will no longer process this request. No selected data will be changed.',
      confirmLabel: 'Cancel request',
      variant: 'destructive',
      onConfirm: async () => {
        setSubmitting(true);
        try {
          const response = await fetch('/api/admin/data-reset', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id, action: 'cancel' }),
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

  const executeRequest = (item: TenantResetRequest) => {
    if (!item.confirmationPhrase) return;
    confirm({
      title: 'Execute this approved reset?',
      description:
        'The scope has already been approved and a recovery point verified. Execution is destructive and cannot be expanded beyond the approved plan.',
      confirmLabel: 'Execute approved reset',
      variant: 'destructive',
      onConfirm: async () => {
        setExecutingId(item.id);
        try {
          const response = await fetch(`/api/admin/data-reset/${item.id}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmationPhrase: executionInputs[item.id] || '' }),
          });
          const json = await response.json();
          if (!response.ok) throw new Error(json.error || 'Reset execution failed');
          setExecutionInputs((current) => ({ ...current, [item.id]: '' }));
          toast({
            title: 'Reset completed',
            description: 'The approved reset plan completed and integrity checks passed.',
            variant: 'success',
          });
          await load();
        } catch (error) {
          toast({
            title: 'Reset not completed',
            description: error instanceof Error ? error.message : 'Execution failed',
            variant: 'error',
          });
          await load();
        } finally {
          setExecutingId(null);
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
        title="Data Reset Builder"
        description="Request a governed operational cleanup, selective reset, or protected clean slate and track it through approval to completion."
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
              Approval and execution are separate safeguards
            </p>
            <p className="text-ink-600 mt-1 text-sm leading-relaxed">
              Submitting a request never deletes data. Platform Administration reviews the impact,
              approves the exact scope and verifies a recovery point. Operational and selective
              resets then return here as <strong>Ready to Execute</strong> for Tenant
              Administration. Protected clean-slate resets remain Platform-executed because they
              remove organisation, people, fleet, access and configuration data.
            </p>
          </div>
        </div>
      </section>

      {!loading && currentRequest && (
        <section
          className={`rounded-[10px] border p-5 ${
            readyRequest
              ? 'border-status-success-text/30 bg-status-success-bg/20'
              : 'border-status-info-text/25 bg-status-info-bg/20'
          }`}
          aria-label="Current reset request"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex items-start gap-3">
              {readyRequest ? (
                <PlayCircle className="text-status-success-text mt-0.5 h-5 w-5 shrink-0" />
              ) : (
                <Clock3 className="text-status-info-text mt-0.5 h-5 w-5 shrink-0" />
              )}
              <div>
                <p className="text-ink-950 text-sm font-semibold">
                  {readyRequest
                    ? 'Approved reset ready to execute'
                    : currentRequest.status === 'pending_review'
                      ? 'Reset request sent — awaiting Platform review'
                      : currentRequest.status === 'draft'
                        ? 'Reset plan drafted by Platform Administration'
                        : currentRequest.status === 'approved' &&
                            currentRequest.platformExecutionRequired
                          ? 'Protected clean slate approved — Platform execution pending'
                          : currentRequest.status === 'approved'
                            ? 'Reset approved — recovery point being verified'
                            : 'Reset currently in progress'}
                </p>
                <p className="text-ink-600 mt-1 max-w-3xl text-sm leading-relaxed">
                  {readyRequest
                    ? 'Platform Administration approved the exact scope and verified its recovery point. Review the confirmation phrase and execute it here when your organisation is ready.'
                    : currentRequest.reason}
                </p>
              </div>
            </div>
            {!readyRequest && (
              <Button variant="secondary" size="sm" onClick={() => showRequest(currentRequest.id)}>
                View request status
              </Button>
            )}
          </div>
          {readyRequest?.confirmationPhrase && (
            <div className="border-status-success-text/20 mt-4 grid gap-3 border-t pt-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
              <div className="space-y-1.5">
                <Label htmlFor={`current-reset-${readyRequest.id}`}>
                  Type <strong>{readyRequest.confirmationPhrase}</strong> to execute only the
                  approved scope
                </Label>
                <Input
                  id={`current-reset-${readyRequest.id}`}
                  aria-label="Reset execution confirmation"
                  value={executionInputs[readyRequest.id] || ''}
                  onChange={(event) =>
                    setExecutionInputs((current) => ({
                      ...current,
                      [readyRequest.id]: event.target.value,
                    }))
                  }
                  autoComplete="off"
                />
              </div>
              <Button
                variant="destructive"
                onClick={() => executeRequest(readyRequest)}
                loading={executingId === readyRequest.id}
                disabled={
                  executingId !== null ||
                  executionInputs[readyRequest.id] !== readyRequest.confirmationPhrase
                }
              >
                Execute approved reset
              </Button>
            </div>
          )}
        </section>
      )}

      {!loading && !currentRequest && expiredApproval && (
        <section className="border-status-warning-text/25 bg-status-warning-bg/20 rounded-[10px] border p-4">
          <div className="flex items-start gap-3">
            <Clock3 className="text-status-warning-text mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="text-ink-950 text-sm font-semibold">Previous approval expired</p>
              <p className="text-ink-600 mt-1 text-sm">
                It can no longer be executed and no longer blocks this form. Submit a new request
                for a fresh Platform review, impact preview and recovery point.
              </p>
            </div>
          </div>
        </section>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Request a reset</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading ? (
              <div className="text-ink-500 flex min-h-48 items-center justify-center gap-2 text-sm">
                <Loader2 className="h-5 w-5 animate-spin" /> Checking current reset status…
              </div>
            ) : (
              <ResetSpecBuilder value={resetBuilder} onChange={setResetBuilder} />
            )}
            {!loading && openRequest ? (
              <div className="border-status-info-text/20 bg-status-info-bg/20 rounded-[8px] border p-4">
                <p className="text-ink-950 text-sm font-semibold">
                  This request is already in progress
                </p>
                <p className="text-ink-600 mt-1 text-xs">
                  Its current status and next action are shown above. Only one active request is
                  allowed at a time.
                </p>
              </div>
            ) : !loading ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-reason">Reset reason</Label>
                  <Textarea
                    id="reset-reason"
                    rows={5}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Explain why the organisation needs a clean operational starting point, what test or historical data should be removed, and when the reset should happen."
                  />
                  <p className="text-ink-400 text-xs">
                    Minimum 20 characters. This becomes part of the protected audit record.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reset-acknowledgement">
                    Type{' '}
                    <span className="text-status-error-text font-semibold">
                      &quot;{TENANT_RESET_REQUEST_PHRASE}&quot;
                    </span>
                  </Label>
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
                  disabled={
                    reason.trim().length < 20 || acknowledgement !== TENANT_RESET_REQUEST_PHRASE
                  }
                >
                  <Database className="h-4 w-4" /> Send for platform approval
                </Button>
              </>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Request history</CardTitle>
          </CardHeader>
          <CardContent>
            <FilterTabs
              items={[
                { value: 'current', label: 'Current & recent', count: currentRequests.length },
                { value: 'history', label: 'Historical', count: historicalRequests.length },
              ]}
              value={requestView}
              onValueChange={setRequestView}
              label="Reset request view"
              className="mb-3"
            />
            {loading ? (
              <div className="text-ink-500 flex min-h-48 items-center justify-center gap-2 text-sm">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading requests…
              </div>
            ) : visibleRequests.length === 0 ? (
              <EmptyState
                icon={<RotateCcw className="h-6 w-6" />}
                title={
                  requestView === 'history'
                    ? 'No historical reset requests'
                    : 'No current reset requests'
                }
                description={
                  requestView === 'history'
                    ? 'Older completed, rejected and cancelled requests will appear here.'
                    : 'Your organisation has no active or recent reset request.'
                }
              />
            ) : (
              <div className="space-y-3">
                {visibleRequests.map((item) => {
                  const status = STATUS[item.status] ?? {
                    label: item.status,
                    variant: 'default' as const,
                    detail: '',
                  };
                  const impact =
                    item.results?.dryRunSummary?.total ??
                    item.validationResults?.dryRunSummary?.total;
                  const isReady = Boolean(item.tenantExecutable && item.confirmationPhrase);
                  const approvedWaitingRecovery =
                    item.status === 'approved' && !item.backupCreated && !item.approvalExpired;
                  const detail = item.approvalExpired
                    ? 'This approval expired and cannot be executed. Submit a new request for a fresh safety review.'
                    : isReady
                      ? 'Platform approval and recovery verification are complete. Review the scope and execute when your organisation is ready.'
                      : item.platformExecutionRequired && item.status === 'approved'
                        ? 'Protected clean slate is approved. Platform Administration performs the final execution after recovery verification.'
                        : approvedWaitingRecovery
                          ? 'Approved. Platform Administration is verifying the recovery point before execution is enabled.'
                          : status.detail;
                  const protectedCategories = item.validationResults?.protected?.length
                    ? item.validationResults.protected
                    : [...RESET_ALWAYS_PROTECTED];

                  return (
                    <article
                      key={item.id}
                      id={`reset-request-${item.id}`}
                      className={`rounded-[8px] border p-4 transition-shadow ${
                        highlightedRequestId === item.id
                          ? 'border-primary-500 ring-primary-500/20 ring-4'
                          : isReady
                            ? 'border-status-success-text/40'
                            : 'border-border'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={
                              item.approvalExpired ? 'error' : isReady ? 'success' : status.variant
                            }
                          >
                            {item.approvalExpired
                              ? 'Approval expired'
                              : isReady
                                ? 'Approved — Ready to execute'
                                : status.label}
                          </Badge>
                          {item.backupCreated && (
                            <Badge variant="success" size="sm">
                              Recovery point verified
                            </Badge>
                          )}
                          {item.platformExecutionRequired && (
                            <Badge variant="warning" size="sm">
                              Platform execution
                            </Badge>
                          )}
                        </div>
                        <span className="text-ink-400 text-xs">{formatDate(item.createdAt)}</span>
                      </div>

                      <p className="text-ink-700 mt-3 text-sm">{item.reason}</p>
                      {item.metadata?.resetSpec?.categories?.length ? (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {item.metadata.resetSpec.categories.map((id) => (
                            <Badge key={id} variant="info" size="sm">
                              {RESET_CATEGORY_CATALOG.find((category) => category.id === id)
                                ?.label ?? id}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      <p className="text-ink-500 mt-2 text-xs">
                        {detail}
                        {typeof impact === 'number' ? ` Impact preview: ${impact} rows.` : ''}
                      </p>

                      {item.reviewedAt && (
                        <dl className="border-border mt-3 grid gap-3 rounded-[8px] border p-3 text-xs sm:grid-cols-2">
                          <div>
                            <dt className="text-ink-400">Approved/reviewed</dt>
                            <dd className="text-ink-700 mt-0.5 font-medium">
                              {formatDate(item.reviewedAt)}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-ink-400">Platform reviewer</dt>
                            <dd className="text-ink-700 mt-0.5 font-medium">
                              {item.reviewedByName || 'Platform Administrator'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-ink-400">Impact preview</dt>
                            <dd className="text-ink-700 mt-0.5 font-medium">
                              {typeof impact === 'number' ? `${impact} rows` : 'Not available'}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-ink-400">Approval expires</dt>
                            <dd
                              className={`mt-0.5 font-medium ${item.approvalExpired ? 'text-status-error-text' : 'text-ink-700'}`}
                            >
                              {formatDate(item.approvalExpiresAt ?? null)}
                              {item.approvalExpired ? ' · expired' : ''}
                            </dd>
                          </div>
                        </dl>
                      )}

                      {['approved', 'in_progress', 'completed'].includes(item.status) && (
                        <div className="mt-3 space-y-2 text-xs">
                          <div>
                            <p className="text-ink-700 font-semibold">Approved scope</p>
                            <p className="text-ink-500 mt-0.5">
                              {(item.metadata?.resetSpec?.categories ?? [])
                                .map(
                                  (id) =>
                                    RESET_CATEGORY_CATALOG.find((category) => category.id === id)
                                      ?.label ?? id,
                                )
                                .join(', ') || item.scope.replaceAll('_', ' ')}
                            </p>
                          </div>
                          <div>
                            <p className="text-ink-700 font-semibold">Explicitly preserved</p>
                            <p className="text-ink-500 mt-0.5">{protectedCategories.join(', ')}</p>
                          </div>
                        </div>
                      )}

                      {!['rejected', 'failed', 'cancelled'].includes(item.status) && (
                        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {[
                            ['Requested', true],
                            ['Impact reviewed', Boolean(item.validationResults?.dryRunSummary)],
                            [
                              'Approved',
                              Boolean(item.reviewedAt) &&
                                ['approved', 'in_progress', 'completed'].includes(item.status),
                            ],
                            ['Recovery verified', item.backupCreated],
                            ['In progress', Boolean(item.startedAt)],
                            ['Completed', item.status === 'completed'],
                          ].map(([label, done]) => (
                            <div
                              key={String(label)}
                              className={`flex items-center gap-1.5 text-xs ${done ? 'text-status-success-text' : 'text-ink-400'}`}
                            >
                              {done ? (
                                <CheckCircle2 className="h-3.5 w-3.5" />
                              ) : (
                                <Clock3 className="h-3.5 w-3.5" />
                              )}
                              <span>{String(label)}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {(item.reviewNotes || item.failureReason) && (
                        <div className="bg-muted/60 mt-3 rounded-[8px] p-3">
                          <p className="text-ink-700 text-xs font-semibold">Platform response</p>
                          <p className="text-ink-600 mt-1 text-xs">
                            {item.reviewNotes || item.failureReason}
                          </p>
                        </div>
                      )}

                      {isReady && item.confirmationPhrase && (
                        <div className="border-status-success-text/20 bg-status-success-bg/20 mt-4 rounded-[8px] border p-3">
                          <div className="flex items-start gap-2">
                            <PlayCircle className="text-status-success-text mt-0.5 h-4 w-4 shrink-0" />
                            <div className="min-w-0 flex-1 space-y-2">
                              <div>
                                <p className="text-ink-950 text-xs font-semibold">
                                  Final tenant execution
                                </p>
                                <p className="text-ink-600 mt-0.5 text-xs">
                                  Execution controls are shown in the prominent current-request
                                  panel above.
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                              >
                                Go to execution controls
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}

                      <div className="text-ink-400 mt-3 flex flex-wrap items-center gap-3 text-xs">
                        {item.status === 'completed' ? (
                          <>
                            <CheckCircle2 className="text-status-success-text h-4 w-4" /> Completed{' '}
                            {formatDate(item.completedAt)}
                          </>
                        ) : item.status === 'rejected' ? (
                          <>
                            <XCircle className="text-status-error-text h-4 w-4" /> Reviewed{' '}
                            {formatDate(item.reviewedAt)}
                          </>
                        ) : (
                          <>
                            <Clock3 className="h-4 w-4" /> Updated {formatDate(item.updatedAt)}
                          </>
                        )}
                        {['draft', 'pending_review'].includes(item.status) && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-status-error-text ml-auto"
                            onClick={() => void cancelRequest(item)}
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
