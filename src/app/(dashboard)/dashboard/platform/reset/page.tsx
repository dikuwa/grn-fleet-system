'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Input, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import {
  Database,
  Search,
  RefreshCw,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  FileText,
  Eye,
  Trash2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useToast } from '@/lib/use-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeProps['variant']; icon: LucideIcon }> = {
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
  temporary_data: { label: 'Temporary Data', description: 'Session data, drafts, ephemeral records' },
  operational: { label: 'Operational', description: 'Requests, trips, fuel, inspections' },
  fleet: { label: 'Fleet', description: 'Vehicles, driver profiles, maintenance' },
  user_access: { label: 'User Access', description: 'Users, role assignments, memberships' },
  full: { label: 'Full Reset', description: 'Everything except tenant config and admin' },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

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

export default function PlatformResetPage() {
  const { toast } = useToast();

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

  // Detail modal state
  const [selectedRequest, setSelectedRequest] = useState<ResetRequest | null>(null);
  const [detailSteps, setDetailSteps] = useState<ResetRequestStep[]>([]);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [dryRunResult, setDryRunResult] = useState<DryRunResult | null>(null);

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (statusFilter) params.set('status', statusFilter);
      if (scopeFilter) params.set('scope', scopeFilter);
      params.set('page', String(page));
      params.set('limit', '25');

      const res = await fetch(`/api/platform/reset?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch');
      setRequests(json.data.requests);
      setStats(json.data.stats);
      setTotalPages(json.data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [searchQuery, statusFilter, scopeFilter, page]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRequests();
  }, [fetchRequests]);

  // -----------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------

  const submitRequest = useCallback(async (id: string) => {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/platform/reset/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'submit' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to submit');
      toast({ title: 'Submitted', description: 'Reset request submitted for review', variant: 'success' });
      fetchRequests();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    } finally {
      setProcessingId(null);
    }
  }, [fetchRequests, toast]);

  const approveRequest = useCallback(async (id: string) => {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/platform/reset/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', reviewNotes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to approve');
      toast({ title: 'Approved', description: 'Reset request approved', variant: 'success' });
      setShowDetailModal(false);
      setSelectedRequest(null);
      setReviewNotes('');
      fetchRequests();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    } finally {
      setProcessingId(null);
    }
  }, [fetchRequests, toast, reviewNotes]);

  const rejectRequest = useCallback(async (id: string) => {
    if (!rejectionReason) {
      toast({ title: 'Error', description: 'Rejection reason is required', variant: 'error' });
      return;
    }
    setProcessingId(id);
    try {
      const res = await fetch(`/api/platform/reset/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', reason: rejectionReason, reviewNotes }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to reject');
      toast({ title: 'Rejected', description: 'Reset request rejected', variant: 'success' });
      setShowDetailModal(false);
      setSelectedRequest(null);
      setRejectionReason('');
      setReviewNotes('');
      fetchRequests();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    } finally {
      setProcessingId(null);
    }
  }, [fetchRequests, toast, rejectionReason, reviewNotes]);

  const runDryRun = useCallback(async (id: string) => {
    setProcessingId(id);
    setDryRunResult(null);
    try {
      const res = await fetch(`/api/platform/reset/${id}/dry-run`, {
        method: 'POST',
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to run dry-run');
      setDryRunResult(json.data);
      toast({ title: 'Dry Run Complete', description: `Will remove ${json.data.dryRunSummary.total} records`, variant: 'success' });
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    } finally {
      setProcessingId(null);
    }
  }, [toast]);

  const executeReset = useCallback(async (id: string) => {
    setProcessingId(id);
    try {
      const res = await fetch(`/api/platform/reset/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmationPhrase: 'RESET GRN FLEET DEVELOPMENT DATA' }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to execute');
      toast({
        title: json.data.result === 'completed' ? 'Reset Complete' : 'Reset Failed',
        description: json.data.result === 'completed'
          ? 'Tenant data has been reset'
          : 'Reset execution encountered errors',
        variant: json.data.result === 'completed' ? 'success' : 'error',
      });
      setShowDetailModal(false);
      setSelectedRequest(null);
      fetchRequests();
    } catch (err) {
      toast({ title: 'Error', description: err instanceof Error ? err.message : 'Failed', variant: 'error' });
    } finally {
      setProcessingId(null);
    }
  }, [fetchRequests, toast]);

  const viewDetails = useCallback(async (req: ResetRequest) => {
    setSelectedRequest(req);
    setShowDetailModal(true);
    setDryRunResult(null);
    setReviewNotes('');
    setRejectionReason('');

    try {
      const res = await fetch(`/api/platform/reset/${req.id}`);
      const json = await res.json();
      if (res.ok && json.data.steps) {
        setDetailSteps(json.data.steps);
      }
    } catch {
      // Silently handle step fetch failure
    }
  }, []);

  // -----------------------------------------------------------------------
  // Render helpers
  // -----------------------------------------------------------------------

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

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        { label: 'Platform', href: '/dashboard/platform' },
        { label: 'Data Reset' },
      ]} />

      <PageHeader
        title="Tenant Data Reset"
        description="Manage tenant data reset requests with approval workflow and audit trail"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-6 gap-4">
        {[
          { label: 'Total', value: stats.total, color: 'text-ink-900' },
          { label: 'Draft', value: stats.draft, color: 'text-ink-500' },
          { label: 'Pending Review', value: stats.pendingReview, color: 'text-status-warning-text' },
          { label: 'Approved', value: stats.approved, color: 'text-status-info-text' },
          { label: 'Completed', value: stats.completed, color: 'text-status-success-text' },
          { label: 'Failed', value: stats.failed, color: 'text-status-error-text' },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="py-3">
              <p className="text-xs text-ink-500">{stat.label}</p>
              <p className={`text-2xl font-semibold ${stat.color}`}>{stat.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
              <input
                type="text"
                placeholder="Search requests..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-2 h-10 text-sm border border-border rounded-[8px] bg-surface focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
              />
            </div>
            <StyledSelect value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="w-44">
              <option value="">All Statuses</option>
              {Object.entries(STATUS_CONFIG).map(([value, config]) => (
                <option key={value} value={value}>{config.label}</option>
              ))}
            </StyledSelect>
            <StyledSelect value={scopeFilter} onChange={(e) => { setScopeFilter(e.target.value); setPage(1); }} className="w-44">
              <option value="">All Scopes</option>
              {Object.entries(SCOPE_CONFIG).map(([value, config]) => (
                <option key={value} value={value}>{config.label}</option>
              ))}
            </StyledSelect>
            <Button variant="secondary" size="compact" onClick={fetchRequests}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Requests List */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-brand-500" />
          <span className="ml-2 text-sm text-ink-500">Loading requests...</span>
        </div>
      ) : error ? (
        <div className="text-center py-16">
          <p className="text-sm text-status-error-text">{error}</p>
          <Button variant="secondary" size="compact" onClick={fetchRequests} className="mt-3">Retry</Button>
        </div>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Database className="h-12 w-12 text-ink-300 mx-auto mb-3" />
            <p className="text-sm text-ink-500 mb-4">No reset requests found</p>
            <p className="text-xs text-ink-400">Create a reset request to get started</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
            {requests.map((req) => {
              const statusConfig = STATUS_CONFIG[req.status] || STATUS_CONFIG.draft;
              const scopeConfig = SCOPE_CONFIG[req.scope] || { label: req.scope, description: '' };
              const StatusIcon = statusConfig.icon;

              return (
                <Card key={req.id} className="hover:border-brand-300 transition-colors">
                  <CardContent className="py-4 px-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3 min-w-0">
                        <StatusIcon className={`h-5 w-5 mt-0.5 shrink-0 ${
                          req.status === 'completed' ? 'text-status-success-text' :
                          req.status === 'failed' ? 'text-status-error-text' :
                          req.status === 'in_progress' ? 'text-status-warning-text animate-spin' :
                          'text-ink-400'
                        }`} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="font-medium text-ink-900">
                              {req.tenantName || req.tenantId.slice(0, 8)}
                            </h3>
                            <Badge variant={statusConfig.variant} size="sm">{statusConfig.label}</Badge>
                            <Badge variant="default" size="sm">{scopeConfig.label}</Badge>
                          </div>
                          <p className="text-sm text-ink-600 mt-1 line-clamp-1">{req.reason}</p>
                          <div className="flex items-center gap-3 text-xs text-ink-400 mt-1">
                            <span>Created {formatDate(req.createdAt)}</span>
                            {req.completedAt && <span>· Completed {formatDate(req.completedAt)}</span>}
                            {req.executionTimeMs && <span>· {formatDuration(req.executionTimeMs)}</span>}
                            {req.backupCreated && (
                              <span className="text-status-success-text">✓ Backup</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button variant="ghost" size="compact" onClick={() => viewDetails(req)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        {req.status === 'draft' && (
                          <Button
                            variant="secondary"
                            size="compact"
                            onClick={() => submitRequest(req.id)}
                            disabled={processingId === req.id}
                          >
                            {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Submit'}
                          </Button>
                        )}
                        {req.status === 'pending_review' && (
                          <>
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => { viewDetails(req); }}
                              className="text-status-success-text"
                            >
                              Review
                            </Button>
                          </>
                        )}
                        {req.status === 'approved' && (
                          <Button
                            variant="secondary"
                            size="compact"
                            onClick={() => runDryRun(req.id)}
                            disabled={processingId === req.id}
                          >
                            {processingId === req.id ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Dry Run'}
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4">
              <p className="text-xs text-ink-500">
                Page {page} of {totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Detail Modal */}
      {showDetailModal && selectedRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-surface rounded-xl shadow-xl max-w-3xl w-full max-h-[80vh] overflow-hidden border border-border">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div>
                <h2 className="text-lg font-semibold text-ink-900">Reset Request Details</h2>
                <p className="text-sm text-ink-500">
                  {SCOPE_CONFIG[selectedRequest.scope]?.label || selectedRequest.scope} — {selectedRequest.tenantName}
                </p>
              </div>
              <Button variant="ghost" size="compact" onClick={() => { setShowDetailModal(false); setSelectedRequest(null); }}>
                <XCircle className="h-5 w-5" />
              </Button>
            </div>

            <div className="px-6 py-4 overflow-y-auto max-h-[60vh] space-y-4">
              {/* Status */}
              <div className="flex items-center gap-3">
                <span className="text-sm text-ink-500">Status:</span>
                <Badge variant={STATUS_CONFIG[selectedRequest.status]?.variant}>
                  {STATUS_CONFIG[selectedRequest.status]?.label}
                </Badge>
              </div>

              {/* Reason */}
              <div>
                <p className="text-xs text-ink-500 mb-1">Reason</p>
                <p className="text-sm text-ink-900">{selectedRequest.reason}</p>
              </div>

              {/* Timing */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-xs text-ink-500">Created</p>
                  <p className="text-sm text-ink-900">{formatDate(selectedRequest.createdAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-500">Started</p>
                  <p className="text-sm text-ink-900">{formatDate(selectedRequest.startedAt)}</p>
                </div>
                <div>
                  <p className="text-xs text-ink-500">Completed</p>
                  <p className="text-sm text-ink-900">{formatDate(selectedRequest.completedAt)}</p>
                </div>
              </div>

              {/* Backup info */}
              {selectedRequest.backupRequired && (
                <div className="bg-brand-50 border border-brand-200 rounded-lg p-3">
                  <p className="text-xs font-medium text-brand-800 mb-1">Backup</p>
                  <p className="text-sm text-brand-700">
                    {selectedRequest.backupCreated
                      ? `Backup created at ${selectedRequest.backupLocation || 'unknown location'}`
                      : 'Backup will be created before execution'}
                  </p>
                </div>
              )}

              {/* Execution steps */}
              {detailSteps.length > 0 && (
                <div>
                  <p className="text-xs text-ink-500 mb-2">Execution Steps</p>
                  <div className="space-y-2">
                    {detailSteps.map((step, idx) => (
                      <div key={idx} className="flex items-center gap-3 text-sm">
                        <span className={`w-2 h-2 rounded-full ${
                          step.status === 'completed' ? 'bg-status-success-text' :
                          step.status === 'failed' ? 'bg-status-error-text' :
                          'bg-ink-300'
                        }`} />
                        <span className="text-ink-700 flex-1">{step.stepName}</span>
                        <span className="text-ink-500">{step.tableName}</span>
                        <span className="text-ink-500">{step.recordsDeleted} deleted</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Dry run results */}
              {dryRunResult && (
                <div className="bg-brand-50 border border-brand-200 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-brand-800 mb-2">Dry Run Results</h4>
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-brand-600">Requests</p>
                      <p className="font-medium text-brand-900">{dryRunResult.dryRunSummary.requests}</p>
                    </div>
                    <div>
                      <p className="text-brand-600">Trips</p>
                      <p className="font-medium text-brand-900">{dryRunResult.dryRunSummary.trips}</p>
                    </div>
                    <div>
                      <p className="text-brand-600">Documents</p>
                      <p className="font-medium text-brand-900">{dryRunResult.dryRunSummary.documents}</p>
                    </div>
                    <div>
                      <p className="text-brand-600">Total</p>
                      <p className="font-medium text-brand-900">{dryRunResult.dryRunSummary.total}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Review notes */}
              {(selectedRequest.status === 'pending_review' || selectedRequest.reviewNotes) && (
                <div>
                  <p className="text-xs text-ink-500 mb-1">Review Notes</p>
                  {selectedRequest.status === 'pending_review' ? (
                    <Textarea
                      placeholder="Add review notes..."
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      rows={2}
                    />
                  ) : (
                    <p className="text-sm text-ink-700">{selectedRequest.reviewNotes || '—'}</p>
                  )}
                </div>
              )}

              {/* Rejection reason */}
              {selectedRequest.status === 'pending_review' && (
                <div>
                  <p className="text-xs text-ink-500 mb-1">Rejection Reason (required to reject)</p>
                  <Input
                    placeholder="Reason for rejection..."
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                  />
                </div>
              )}

              {/* Failure reason */}
              {selectedRequest.failureReason && (
                <div className="bg-status-error-bg border border-status-error-border rounded-lg p-3">
                  <p className="text-xs font-medium text-status-error-text mb-1">Failure Reason</p>
                  <p className="text-sm text-status-error-text">{selectedRequest.failureReason}</p>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
              <Button variant="secondary" onClick={() => { setShowDetailModal(false); setSelectedRequest(null); }}>
                Close
              </Button>
              {selectedRequest.status === 'pending_review' && (
                <>
                  <Button
                    variant="secondary"
                    onClick={() => rejectRequest(selectedRequest.id)}
                    disabled={processingId === selectedRequest.id || !rejectionReason}
                    className="text-status-error-text"
                  >
                    {processingId === selectedRequest.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <XCircle className="h-4 w-4 mr-1" />}
                    Reject
                  </Button>
                  <Button
                    onClick={() => approveRequest(selectedRequest.id)}
                    disabled={processingId === selectedRequest.id}
                  >
                    {processingId === selectedRequest.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle className="h-4 w-4 mr-1" />}
                    Approve
                  </Button>
                </>
              )}
              {selectedRequest.status === 'approved' && (
                <Button
                  onClick={() => executeReset(selectedRequest.id)}
                  disabled={processingId === selectedRequest.id}
                  className="bg-status-error-text hover:bg-status-error-text/90"
                >
                  {processingId === selectedRequest.id ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Trash2 className="h-4 w-4 mr-1" />}
                  Execute Reset
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
