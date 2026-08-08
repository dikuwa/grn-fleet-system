'use client';

import { useCallback, useEffect, useState } from 'react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { EmptyState } from '@/components/ui/empty-state';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  CheckCircle,
  Clock,
  Database,
  Eye,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

interface ResetRequest {
  id: string;
  tenantId: string;
  tenantName: string | null;
  scope: string;
  reason: string;
  status: string;
  requestedByUserId: string;
  backupRequired: boolean;
  backupCreated: boolean;
  backupLocation: string | null;
  startedAt: string | null;
  completedAt: string | null;
  executionTimeMs: number | null;
  reviewedByUserId: string | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  results: Record<string, unknown> | null;
  failureReason: string | null;
  rollbackPossible: boolean;
  rollbackPerformed: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ResetStats {
  total: number;
  draft: number;
  pendingReview: number;
  approved: number;
  completed: number;
  failed: number;
}

interface ResetRequestStep {
  stepName: string;
  tableName: string;
  recordsDeleted: number;
  status: string;
}

interface DryRunResult {
  dryRunSummary: {
    requests: number;
    trips: number;
    documents: number;
    total: number;
  };
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: BadgeProps['variant']; icon: LucideIcon }
> = {
  draft: { label: 'Draft', variant: 'default', icon: FileText },
  pending_review: { label: 'Pending Review', variant: 'warning', icon: Clock },
  approved: { label: 'Approved', variant: 'info', icon: CheckCircle },
  in_progress: { label: 'In Progress', variant: 'warning', icon: Loader2 },
  completed: { label: 'Completed', variant: 'success', icon: CheckCircle },
  failed: { label: 'Failed', variant: 'error', icon: XCircle },
  cancelled: { label: 'Cancelled', variant: 'default', icon: XCircle },
  rejected: { label: 'Rejected', variant: 'error', icon: XCircle },
};

const SCOPE_CONFIG: Record<string, { label: string; description: string }> = {
  temporary_data: { label: 'Temporary Data', description: 'Session data, drafts and ephemeral records' },
  operational: { label: 'Operational', description: 'Requests, trips, fuel and inspections' },
  fleet: { label: 'Fleet', description: 'Vehicles, driver profiles and maintenance' },
  user_access: { label: 'User Access', description: 'Users, role assignments and memberships' },
  full: { label: 'Full Reset', description: 'Everything except tenant configuration and administrator access' },
};

const EXECUTION_CONFIRMATION = 'RESET GRN FLEET DEVELOPMENT DATA';

export default function PlatformResetPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [stats, setStats] = useState<ResetStats>({
    total: 0,
    draft: 0,
    pendingReview: 0,
    approved: 0,
    completed: 0,
    failed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [scopeFilter, setScopeFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const [selectedRequest, setSelectedRequest] = useState<ResetRequest | null>(null);
  const [detailSteps, setDetailSteps] = useState<ResetRequestStep[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('q', searchQuery.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (scopeFilter) params.set('scope', scopeFilter);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/platform/reset?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch reset requests');
      setRequests(json.data?.requests ?? []);
      setStats(json.data?.stats ?? stats);
      setTotalPages(json.data?.totalPages ?? 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reset requests');
    } finally {
      setLoading(false);
    }
  }, [page, scopeFilter, searchQuery, statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => void fetchRequests(), 250);
    return () => window.clearTimeout(timer);
  }, [fetchRequests]);

  const submitRequest = useCallback(
    async (id: string) => {
      setProcessingId(id);
      try {
        const res = await fetch(`/api/platform/reset/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'submit' }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to submit');
        toast({ title: 'Reset request submitted', description: 'The request is ready for review.', variant: 'success' });
        await fetchRequests();
      } catch (err) {
        toast({ title: 'Submission failed', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
      } finally {
        setProcessingId(null);
      }
    },
    [fetchRequests, toast],
  );

  const approveRequest = useCallback(
    async (id: string) => {
      setProcessingId(id);
      try {
        const res = await fetch(`/api/platform/reset/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve', reviewNotes }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to approve');
        toast({ title: 'Reset request approved', variant: 'success' });
        setShowDetailModal(false);
        setSelectedRequest(null);
        setReviewNotes('');
        await fetchRequests();
      } catch (err) {
        toast({ title: 'Approval failed', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
      } finally {
        setProcessingId(null);
      }
    },
    [fetchRequests, reviewNotes, toast],
  );

  const rejectRequest = useCallback(
    async (id: string) => {
      if (!rejectionReason.trim()) {
        toast({ title: 'Rejection reason required', description: 'Explain why the reset request cannot proceed.', variant: 'error' });
        return;
      }
      setProcessingId(id);
      try {
        const res = await fetch(`/api/platform/reset/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reject', reason: rejectionReason.trim(), reviewNotes }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to reject');
        toast({ title: 'Reset request rejected', variant: 'success' });
        setShowDetailModal(false);
        setSelectedRequest(null);
        setRejectionReason('');
        setReviewNotes('');
        await fetchRequests();
      } catch (err) {
        toast({ title: 'Rejection failed', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
      } finally {
        setProcessingId(null);
      }
    },
    [fetchRequests, rejectionReason, reviewNotes, toast],
  );

  const runDryRun = useCallback(
    async (id: string) => {
      setProcessingId(id);
      setDryRunResult(null);
      try {
        const res = await fetch(`/api/platform/reset/${id}/dry-run`, { method: 'POST' });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to run dry run');
        setDryRunResult(json.data);
        toast({
          title: 'Dry run complete',
          description: `${json.data.dryRunSummary.total} records would be removed.`,
          variant: 'success',
        });
      } catch (err) {
        toast({ title: 'Dry run failed', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
      } finally {
        setProcessingId(null);
      }
    },
    [toast],
  );

  const executeReset = useCallback(
    async (id: string) => {
      setProcessingId(id);
      try {
        const res = await fetch(`/api/platform/reset/${id}/execute`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirmationPhrase: EXECUTION_CONFIRMATION }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Failed to execute reset');
        const completed = json.data.result === 'completed';
        toast({
          title: completed ? 'Reset complete' : 'Reset failed',
          description: completed ? 'Tenant data has been reset.' : 'Reset execution encountered errors.',
          variant: completed ? 'success' : 'error',
        });
        setShowDetailModal(false);
        setSelectedRequest(null);
        await fetchRequests();
      } catch (err) {
        toast({ title: 'Reset execution failed', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
      } finally {
        setProcessingId(null);
      }
    },
    [fetchRequests, toast],
  );

  const requestExecution = (request: ResetRequest) => {
    setShowDetailModal(false);
    confirm({
      title: `Execute reset for ${request.tenantName || 'this tenant'}?`,
      description: 'This is a destructive operation. Review the dry run and backup status first. Type the exact confirmation phrase to continue.',
      confirmLabel: 'Execute Reset',
      variant: 'destructive',
      requireTypedConfirm: EXECUTION_CONFIRMATION,
      onConfirm: async () => {
        await executeReset(request.id);
      },
    });
  };

  const viewDetails = useCallback(async (request: ResetRequest) => {
    setSelectedRequest(request);
    setShowDetailModal(true);
    setDryRunResult(null);
    setReviewNotes('');
    setRejectionReason('');
    setDetailSteps([]);

    try {
      const res = await fetch(`/api/platform/reset/${request.id}`);
      const json = await res.json();
      if (res.ok && json.data?.steps) setDetailSteps(json.data.steps);
    } catch {
      toast({ title: 'Some reset details could not be loaded', description: 'The request summary is still available.', variant: 'error' });
    }
  }, [toast]);

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-NA', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatDuration = (ms: number | null) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
  };

  const statsList = [
    { label: 'Total', value: stats.total, tone: 'text-ink-950' },
    { label: 'Draft', value: stats.draft, tone: 'text-ink-700' },
    { label: 'Pending Review', value: stats.pendingReview, tone: 'text-status-warning-text' },
    { label: 'Approved', value: stats.approved, tone: 'text-status-info-text' },
    { label: 'Completed', value: stats.completed, tone: 'text-status-success-text' },
    { label: 'Failed', value: stats.failed, tone: 'text-status-error-text' },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Data Reset' }]} />
      <PageHeader
        title="Tenant Data Reset"
        description="Review and execute controlled tenant reset requests with dry-run, backup and audit safeguards."
      />

      <div className="border-border grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border bg-border sm:grid-cols-3 lg:grid-cols-6">
        {statsList.map((stat) => (
          <div key={stat.label} className="bg-surface px-4 py-3">
            <p className="text-ink-500 text-xs">{stat.label}</p>
            <p className={`mt-1 text-xl font-semibold tabular-nums ${stat.tone}`}>{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="border-border grid gap-3 border-y py-4 sm:grid-cols-2 lg:grid-cols-[minmax(240px,1fr)_190px_190px_auto] lg:items-center">
        <div className="relative">
          <Search className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" aria-hidden="true" />
          <Input
            type="search"
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
            placeholder="Search reset requests..."
            className="pl-9"
          />
        </div>
        <StyledSelect value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} aria-label="Filter reset requests by status">
          <option value="">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
        </StyledSelect>
        <StyledSelect value={scopeFilter} onChange={(e) => { setScopeFilter(e.target.value); setPage(1); }} aria-label="Filter reset requests by scope">
          <option value="">All scopes</option>
          {Object.entries(SCOPE_CONFIG).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
        </StyledSelect>
        <Button variant="secondary" size="sm" onClick={() => void fetchRequests()} loading={loading}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Refresh
        </Button>
      </div>

      {(searchQuery || statusFilter || scopeFilter) && (
        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setStatusFilter(''); setScopeFilter(''); setPage(1); }}>
            Clear filters
          </Button>
        </div>
      )}

      {loading ? (
        <div className="text-ink-500 flex items-center justify-center gap-2 py-14 text-sm">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading reset requests…
        </div>
      ) : error ? (
        <EmptyState icon={<Database className="h-6 w-6" />} title="Could not load reset requests" description={error} action={{ label: 'Retry', onClick: fetchRequests }} />
      ) : requests.length === 0 ? (
        <EmptyState icon={<Database className="h-6 w-6" />} title="No reset requests found" description="There are no reset requests matching the current filters." />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {requests.map((request) => {
            const statusConfig = STATUS_CONFIG[request.status] || STATUS_CONFIG.draft;
            const scopeConfig = SCOPE_CONFIG[request.scope] || { label: request.scope, description: '' };
            const StatusIcon = statusConfig.icon;
            const processing = processingId === request.id;
            return (
              <article key={request.id} className="border-border grid gap-4 border-b px-4 py-4 last:border-b-0 sm:px-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusIcon className={`h-4 w-4 shrink-0 ${request.status === 'completed' ? 'text-status-success-text' : request.status === 'failed' ? 'text-status-error-text' : 'text-ink-400'} ${request.status === 'in_progress' ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" />
                    <h2 className="text-ink-950 text-sm font-semibold">{request.tenantName || request.tenantId.slice(0, 8)}</h2>
                    <Badge variant={statusConfig.variant} size="sm">{statusConfig.label}</Badge>
                    <Badge variant="default" size="sm">{scopeConfig.label}</Badge>
                  </div>
                  <p className="text-ink-600 mt-2 line-clamp-2 text-sm">{request.reason}</p>
                  <div className="text-ink-400 mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span>Created {formatDate(request.createdAt)}</span>
                    {request.completedAt && <span>Completed {formatDate(request.completedAt)}</span>}
                    {request.executionTimeMs ? <span>{formatDuration(request.executionTimeMs)}</span> : null}
                    {request.backupCreated && <span className="text-status-success-text">Backup created</span>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button variant="ghost" size="sm" onClick={() => void viewDetails(request)}>
                    <Eye className="h-4 w-4" aria-hidden="true" /> Details
                  </Button>
                  {request.status === 'draft' && (
                    <Button variant="secondary" size="sm" onClick={() => void submitRequest(request.id)} loading={processing}>Submit</Button>
                  )}
                  {request.status === 'pending_review' && (
                    <Button variant="secondary" size="sm" onClick={() => void viewDetails(request)}>Review</Button>
                  )}
                  {request.status === 'approved' && (
                    <Button variant="secondary" size="sm" onClick={() => void runDryRun(request.id)} loading={processing}>Dry Run</Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-ink-500 text-xs">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1}>Previous</Button>
            <Button variant="secondary" size="sm" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages}>Next</Button>
          </div>
        </div>
      )}

      <Dialog open={showDetailModal} onOpenChange={(open) => { if (!processingId) { setShowDetailModal(open); if (!open) setSelectedRequest(null); } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          {selectedRequest && (
            <>
              <DialogHeader>
                <DialogTitle>Reset Request Details</DialogTitle>
                <DialogDescription>
                  {SCOPE_CONFIG[selectedRequest.scope]?.label || selectedRequest.scope} — {selectedRequest.tenantName || selectedRequest.tenantId}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5 py-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={STATUS_CONFIG[selectedRequest.status]?.variant}>{STATUS_CONFIG[selectedRequest.status]?.label || selectedRequest.status}</Badge>
                  <span className="text-ink-500 text-xs">Created {formatDate(selectedRequest.createdAt)}</span>
                </div>

                <section>
                  <h3 className="text-ink-500 text-xs font-medium">Reason</h3>
                  <p className="text-ink-900 mt-1 text-sm">{selectedRequest.reason}</p>
                </section>

                <div className="grid gap-3 sm:grid-cols-3">
                  {[['Created', selectedRequest.createdAt], ['Started', selectedRequest.startedAt], ['Completed', selectedRequest.completedAt]].map(([label, value]) => (
                    <div key={label} className="border-border rounded-[8px] border p-3">
                      <p className="text-ink-500 text-xs">{label}</p>
                      <p className="text-ink-900 mt-1 text-sm">{formatDate(value)}</p>
                    </div>
                  ))}
                </div>

                {selectedRequest.backupRequired && (
                  <div className="border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/30 rounded-[8px] border p-3">
                    <p className="text-brand-800 dark:text-brand-200 text-xs font-medium">Backup safeguard</p>
                    <p className="text-brand-700 dark:text-brand-300 mt-1 text-sm">
                      {selectedRequest.backupCreated ? `Backup created${selectedRequest.backupLocation ? ` at ${selectedRequest.backupLocation}` : ''}.` : 'A backup is required before execution.'}
                    </p>
                  </div>
                )}

                {detailSteps.length > 0 && (
                  <section>
                    <h3 className="text-ink-500 mb-2 text-xs font-medium">Execution Steps</h3>
                    <div className="border-border divide-border overflow-hidden rounded-[8px] border divide-y">
                      {detailSteps.map((step, index) => (
                        <div key={`${step.tableName}-${index}`} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[1fr_160px_auto] sm:items-center">
                          <span className="text-ink-800">{step.stepName}</span>
                          <span className="text-ink-500 font-mono text-xs">{step.tableName}</span>
                          <span className="text-ink-500 text-xs">{step.recordsDeleted} deleted</span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {dryRunResult && (
                  <section className="border-brand-200 bg-brand-50 dark:border-brand-800 dark:bg-brand-950/30 rounded-[8px] border p-4">
                    <h3 className="text-brand-800 dark:text-brand-200 text-sm font-medium">Dry Run Results</h3>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {Object.entries(dryRunResult.dryRunSummary).map(([label, value]) => (
                        <div key={label}><p className="text-brand-600 dark:text-brand-300 text-xs capitalize">{label}</p><p className="text-brand-900 dark:text-brand-100 mt-1 font-semibold tabular-nums">{value}</p></div>
                      ))}
                    </div>
                  </section>
                )}

                {(selectedRequest.status === 'pending_review' || selectedRequest.reviewNotes) && (
                  <section>
                    <h3 className="text-ink-500 mb-1 text-xs font-medium">Review Notes</h3>
                    {selectedRequest.status === 'pending_review' ? (
                      <Textarea value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} rows={3} placeholder="Add review notes..." />
                    ) : (
                      <p className="text-ink-700 text-sm">{selectedRequest.reviewNotes || '—'}</p>
                    )}
                  </section>
                )}

                {selectedRequest.status === 'pending_review' && (
                  <section>
                    <h3 className="text-ink-500 mb-1 text-xs font-medium">Rejection Reason</h3>
                    <Input value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="Required only when rejecting" />
                  </section>
                )}

                {selectedRequest.failureReason && (
                  <div className="bg-status-error-bg text-status-error-text rounded-[8px] p-3" role="alert">
                    <p className="text-xs font-medium">Failure Reason</p>
                    <p className="mt-1 text-sm">{selectedRequest.failureReason}</p>
                  </div>
                )}
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="secondary" onClick={() => { setShowDetailModal(false); setSelectedRequest(null); }} disabled={Boolean(processingId)}>Close</Button>
                {selectedRequest.status === 'pending_review' && (
                  <>
                    <Button variant="secondary" onClick={() => void rejectRequest(selectedRequest.id)} loading={processingId === selectedRequest.id} disabled={!rejectionReason.trim()} className="text-status-error-text">Reject</Button>
                    <Button onClick={() => void approveRequest(selectedRequest.id)} loading={processingId === selectedRequest.id}>Approve</Button>
                  </>
                )}
                {selectedRequest.status === 'approved' && (
                  <>
                    <Button variant="secondary" onClick={() => void runDryRun(selectedRequest.id)} loading={processingId === selectedRequest.id}>Dry Run</Button>
                    <Button variant="destructive" onClick={() => requestExecution(selectedRequest)} disabled={Boolean(processingId)}>
                      <Trash2 className="h-4 w-4" aria-hidden="true" /> Execute Reset
                    </Button>
                  </>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
