'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { syncPendingDrafts, syncSingleDraft } from '@/lib/offline-sync';
import {
  listDrafts,
  deleteDraft,
  getDraft,
} from '@/lib/offline-drafts';
import type { OfflineDraft } from '@/lib/offline-drafts';
import {
  WifiOff,
  RefreshCw,
  Database,
  Trash2,
  Eye,
  X,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Clock,
  RotateCcw,
} from 'lucide-react';

type SortKey = 'updatedAt' | 'draftType' | 'syncStatus';
type SyncStatus = 'all' | 'pending' | 'failed' | 'conflict' | 'synced';

const DRAFT_TYPE_LABELS: Record<string, string> = {
  fuel: 'Fuel Transaction',
  request: 'Transport Request',
  trip_log: 'Trip Log Entry',
  inspection_departure: 'Departure Inspection',
  inspection_return: 'Return Inspection',
};

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending Sync',
  syncing: 'Syncing…',
  synced: 'Synced',
  conflict: 'Conflict',
  failed: 'Failed',
};

const STATUS_VARIANTS: Record<string, 'pending' | 'success' | 'error' | 'info'> = {
  pending: 'pending',
  syncing: 'info',
  synced: 'success',
  conflict: 'error',
  failed: 'error',
};

export default function OfflinePage() {
  const [drafts, setDrafts] = useState<OfflineDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SyncStatus>('all');
  const [selectedDraft, setSelectedDraft] = useState<OfflineDraft | null>(null);
  const [summary, setSummary] = useState({ pending: 0, failed: 0, conflict: 0, synced: 0 });

  const loadDrafts = useCallback(async () => {
    setLoading(true);
    try {
      const all = await listDrafts();
      setDrafts(all);
      setSummary({
        pending: all.filter((d) => d.syncStatus === 'pending').length,
        failed: all.filter((d) => d.syncStatus === 'failed').length,
        conflict: all.filter((d) => d.syncStatus === 'conflict').length,
        synced: all.filter((d) => d.syncStatus === 'synced').length,
      });
    } catch {
      setDrafts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const result = await syncPendingDrafts();
      await loadDrafts();
      if (result.synced > 0 || result.failed > 0) {
        window.dispatchEvent(new CustomEvent('offline-sync-complete', { detail: result }));
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleRetrySingle = async (draftId: string) => {
    setSyncing(true);
    try {
      await syncSingleDraft(draftId);
      await loadDrafts();
      window.dispatchEvent(new CustomEvent('offline-sync-complete', { detail: { synced: 1, failed: 0, errors: [] } }));
    } finally {
      setSyncing(false);
    }
  };

  const handleDiscard = async (id: string) => {
    await deleteDraft(id);
    await loadDrafts();
  };

  const handleViewDetail = async (id: string) => {
    try {
      const draft = await getDraft(id);
      setSelectedDraft(draft ?? null);
    } catch (err) {
      console.error('[Offline] Failed to load draft detail:', err);
    }
  };

  const filteredDrafts = statusFilter === 'all'
    ? drafts
    : drafts.filter((d) => d.syncStatus === statusFilter);

  const sortedDrafts = [...filteredDrafts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Offline Drafts' },
        ]}
      />
      <PageHeader
        title="Offline Drafts"
        description="Manage locally stored drafts and resolve sync conflicts"
      >
        <Button
          variant="primary"
          size="sm"
          onClick={handleSyncAll}
          loading={syncing}
          disabled={syncing || (summary.pending === 0 && summary.failed === 0)}
        >
          <RefreshCw className="h-4 w-4" />
          Sync All
        </Button>
      </PageHeader>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Pending</p>
                <p className="mt-1 text-2xl font-[650] tabular-nums text-status-pending-text">
                  {summary.pending}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-pending-bg">
                <Clock className="h-5 w-5 text-status-pending-text" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Failed</p>
                <p className="mt-1 text-2xl font-[650] tabular-nums text-status-error-text">
                  {summary.failed}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-error-bg">
                <AlertTriangle className="h-5 w-5 text-status-error-text" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Conflicts</p>
                <p className="mt-1 text-2xl font-[650] tabular-nums text-status-error-text">
                  {summary.conflict}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-status-error-bg">
                <AlertTriangle className="h-5 w-5 text-status-error-text" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-ink-500">Total Unsynced</p>
                <p className="mt-1 text-2xl font-[650] tabular-nums text-ink-950">
                  {summary.pending + summary.failed + summary.conflict}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
                <Database className="h-5 w-5 text-ink-500" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Status Filter Tabs */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'failed', 'conflict', 'synced'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === status
                ? 'bg-brand-900 text-white'
                : 'bg-surface text-ink-500 hover:bg-muted hover:text-ink-700'
            }`}
          >
            {status === 'all' ? 'All' : STATUS_LABELS[status]}
            {status !== 'all' && (
              <span className="ml-1.5 tabular-nums">
                ({summary[status as keyof typeof summary]})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Draft List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            {statusFilter === 'all' ? 'All Drafts' : `${STATUS_LABELS[statusFilter]} Drafts`}
            <span className="text-xs font-normal text-ink-500 tabular-nums">
              ({sortedDrafts.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-ink-400" />
            </div>
          ) : sortedDrafts.length === 0 ? (
            <EmptyState
              icon={<Database className="h-6 w-6" />}
              title="No Drafts Found"
              description={statusFilter === 'all' ? 'No offline drafts saved yet.' : `No drafts with "${STATUS_LABELS[statusFilter]}" status.`}
            />
          ) : (
            <div className="space-y-2">
              {sortedDrafts.map((draft) => (
                <div
                  key={draft.id}
                  className={`rounded-[8px] border p-3 transition-colors ${
                    draft.syncStatus === 'conflict'
                      ? 'border-status-error-bg/40 bg-status-error-bg/10'
                      : draft.syncStatus === 'failed'
                        ? 'border-status-error-bg/20 bg-status-error-bg/5'
                        : draft.syncStatus === 'synced'
                          ? 'border-status-success-bg/20 bg-status-success-bg/5'
                          : 'border-border bg-surface'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-ink-950">
                          {DRAFT_TYPE_LABELS[draft.draftType] ?? draft.draftType}
                        </p>
                        <Badge variant={STATUS_VARIANTS[draft.syncStatus]} size="sm">
                          {STATUS_LABELS[draft.syncStatus]}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-500 tabular-nums">
                        Updated {new Date(draft.updatedAt).toLocaleString()}
                      </p>
                      {draft.syncError && (
                        <p className="mt-1 text-xs text-status-error-text truncate max-w-md">
                          <AlertTriangle className="h-3 w-3 inline-block mr-1 -mt-0.5" />
                          {draft.syncError}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleViewDetail(draft.id)}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      {(draft.syncStatus === 'failed' || draft.syncStatus === 'conflict') && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRetrySingle(draft.id)}
                          disabled={syncing}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleDiscard(draft.id)}
                        className="text-status-error-text hover:bg-status-error-bg/20"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail Modal */}
      {selectedDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <Card className="w-full max-w-lg max-h-[80vh] overflow-y-auto">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Draft Details</span>
                <button
                  onClick={() => setSelectedDraft(null)}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-400 hover:bg-muted hover:text-ink-700 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-xs text-ink-500">Type</p>
                  <p className="text-sm font-medium text-ink-950">
                    {DRAFT_TYPE_LABELS[selectedDraft.draftType] ?? selectedDraft.draftType}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-500">Status</p>
                  <Badge variant={STATUS_VARIANTS[selectedDraft.syncStatus]} size="sm" className="mt-0.5">
                    {STATUS_LABELS[selectedDraft.syncStatus]}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs text-ink-500">Created</p>
                  <p className="text-sm text-ink-950 tabular-nums">
                    {new Date(selectedDraft.createdAt).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-ink-500">Updated</p>
                  <p className="text-sm text-ink-950 tabular-nums">
                    {new Date(selectedDraft.updatedAt).toLocaleString()}
                  </p>
                </div>
                {selectedDraft.syncedEntityId && (
                  <div className="col-span-2">
                    <p className="text-xs text-ink-500">Synced Entity ID</p>
                    <p className="text-sm text-ink-950 font-mono truncate">{selectedDraft.syncedEntityId}</p>
                  </div>
                )}
              </div>

              {selectedDraft.syncError && (
                <div className="rounded-[8px] border border-status-error-bg/40 bg-status-error-bg/10 p-3">
                  <p className="text-xs font-medium text-status-error-text">Sync Error</p>
                  <p className="text-sm text-ink-700 mt-1">{selectedDraft.syncError}</p>
                </div>
              )}

              <div>
                <p className="text-xs text-ink-500 mb-2">Form Data</p>
                <pre className="rounded-[8px] bg-muted p-3 text-xs text-ink-700 overflow-x-auto max-h-48 whitespace-pre-wrap font-mono">
                  {JSON.stringify(selectedDraft.formData, null, 2)}
                </pre>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setSelectedDraft(null)}>
                  Close
                </Button>
                {(selectedDraft.syncStatus === 'failed' || selectedDraft.syncStatus === 'conflict') && (
                  <Button variant="primary" size="sm" onClick={() => handleRetrySingle(selectedDraft.id)} loading={syncing} disabled={syncing}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry Sync
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    handleDiscard(selectedDraft.id);
                    setSelectedDraft(null);
                  }}
                  className="text-status-error-text"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Discard Draft
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
