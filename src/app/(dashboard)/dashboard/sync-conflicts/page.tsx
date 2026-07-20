'use client';

import { useState, useEffect } from 'react';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { listDrafts, deleteDraft, updateDraft } from '@/lib/offline-drafts';
import type { OfflineDraft } from '@/lib/offline-drafts';
import { syncPendingDrafts } from '@/lib/offline-sync';
import {
  AlertTriangle,
  RefreshCw,
  Trash2,
  WifiOff,
  CheckCircle2,
  XCircle,
  Clock,
  Fuel,
  ClipboardCheck,
  FileText,
  Truck,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';

const DRAFT_TYPE_LABELS: Record<string, string> = {
  fuel: 'Fuel Entry',
  request: 'Transport Request',
  trip_log: 'Trip Log',
  inspection_departure: 'Departure Inspection',
  inspection_return: 'Return Inspection',
};

const DRAFT_TYPE_ICONS: Record<string, React.ReactNode> = {
  fuel: <Fuel className="h-4 w-4" />,
  trip_log: <FileText className="h-4 w-4" />,
  inspection_departure: <ClipboardCheck className="h-4 w-4" />,
  inspection_return: <ClipboardCheck className="h-4 w-4" />,
};

export default function SyncConflictsPage() {
  const [drafts, setDrafts] = useState<OfflineDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ synced: number; failed: number } | null>(null);
  const [expandedDraft, setExpandedDraft] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'conflict' | 'failed' | 'pending'>('all');

  async function loadDrafts() {
    setLoading(true);
    try {
      const filters =
        activeTab === 'all'
          ? undefined
          : { syncStatus: activeTab as 'conflict' | 'failed' | 'pending' };
      const all = await listDrafts(filters);
      setDrafts(all);
    } catch (err) {
      console.error('Failed to load drafts:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDrafts();
  }, [activeTab]);

  async function handleSync() {
    setSyncing(true);
    setSyncResult(null);
    try {
      const result = await syncPendingDrafts();
      setSyncResult({ synced: result.synced, failed: result.failed });
      await loadDrafts();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleDelete(draftId: string) {
    await deleteDraft(draftId);
    setDrafts((prev) => prev.filter((d) => d.id !== draftId));
  }

  async function handleRetry(draftId: string) {
    setSyncing(true);
    try {
      await updateDraft(draftId, { syncStatus: 'pending', syncError: null });
      await handleSync();
    } finally {
      setSyncing(false);
    }
  }

  const statusCounts = {
    all: drafts.length,
    pending: drafts.filter((d) => d.syncStatus === 'pending').length,
    failed: drafts.filter((d) => d.syncStatus === 'failed').length,
    conflict: drafts.filter((d) => d.syncStatus === 'conflict').length,
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Dashboard', href: '/dashboard' },
          { label: 'Sync Conflicts' },
        ]}
      />
      <PageHeader
        title="Offline Draft Sync"
        description="Manage offline drafts, resolve conflicts, and sync pending data"
      >
        <Button variant="primary" size="sm" onClick={handleSync} loading={syncing}>
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing...' : 'Sync All Pending'}
        </Button>
      </PageHeader>

      {/* Sync Result Banner */}
      {syncResult && (
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-3">
              {syncResult.synced > 0 ? (
                <CheckCircle2 className="h-5 w-5 text-status-success-text" />
              ) : (
                <XCircle className="h-5 w-5 text-status-error-text" />
              )}
              <div>
                <p className="text-sm font-medium text-ink-950">
                  {syncResult.synced > 0
                    ? `${syncResult.synced} draft${syncResult.synced !== 1 ? 's' : ''} synced successfully`
                    : 'No drafts were synced'}
                </p>
                {syncResult.failed > 0 && (
                  <p className="text-xs text-status-error-text">
                    {syncResult.failed} draft${syncResult.failed !== 1 ? 's' : ''} failed
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-4">
        <Card
          className={`cursor-pointer transition-colors ${activeTab === 'all' ? 'ring-2 ring-brand-600' : ''}`}
          onClick={() => setActiveTab('all')}
        >
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-ink-950">{statusCounts.all}</p>
            <p className="text-xs text-ink-500">Total Drafts</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === 'pending' ? 'ring-2 ring-brand-600' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-pending-text">{statusCounts.pending}</p>
            <p className="text-xs text-ink-500">Pending</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === 'failed' ? 'ring-2 ring-brand-600' : ''}`}
          onClick={() => setActiveTab('failed')}
        >
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-error-text">{statusCounts.failed}</p>
            <p className="text-xs text-ink-500">Failed</p>
          </CardContent>
        </Card>
        <Card
          className={`cursor-pointer transition-colors ${activeTab === 'conflict' ? 'ring-2 ring-brand-600' : ''}`}
          onClick={() => setActiveTab('conflict')}
        >
          <CardContent className="pt-4 text-center">
            <p className="text-2xl font-[650] tabular-nums text-status-emergency-text">{statusCounts.conflict}</p>
            <p className="text-xs text-ink-500">Conflicts</p>
          </CardContent>
        </Card>
      </div>

      {/* Draft List */}
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="py-6"><div className="h-6 bg-muted rounded animate-pulse" /></CardContent></Card>
          ))}
        </div>
      ) : drafts.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="h-8 w-8" />}
          title="All Clear"
          description={activeTab === 'all' ? 'No offline drafts found. All data is synced.' : `No ${activeTab} drafts found.`}
        />
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => {
            const isExpanded = expandedDraft === draft.id;
            const syncLabel =
              draft.syncStatus === 'conflict'
                ? 'Conflict'
                : draft.syncStatus === 'failed'
                  ? 'Failed'
                  : draft.syncStatus === 'pending'
                    ? 'Pending'
                    : draft.syncStatus === 'syncing'
                      ? 'Syncing...'
                      : 'Synced';
            const syncVariant: 'emergency' | 'error' | 'pending' | 'info' | 'success' =
              draft.syncStatus === 'conflict'
                ? 'emergency'
                : draft.syncStatus === 'failed'
                  ? 'error'
                  : draft.syncStatus === 'pending'
                    ? 'pending'
                    : draft.syncStatus === 'syncing'
                      ? 'info'
                      : 'success';

            return (
              <Card key={draft.id}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div
                      className="flex items-center gap-3 min-w-0 flex-1 cursor-pointer"
                      onClick={() => setExpandedDraft(isExpanded ? null : draft.id)}
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[8px] bg-muted text-ink-500">
                        {DRAFT_TYPE_ICONS[draft.draftType] || <FileText className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ink-950">
                            {DRAFT_TYPE_LABELS[draft.draftType] || draft.draftType}
                          </p>
                          <Badge variant={syncVariant} size="sm">{syncLabel}</Badge>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                          <span className="tabular-nums">{new Date(draft.updatedAt).toLocaleString()}</span>
                          {draft.syncedEntityId && <span className="font-mono">ID: {draft.syncedEntityId.slice(0, 8)}...</span>}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {draft.syncStatus !== 'synced' && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleRetry(draft.id)}
                          loading={syncing}
                        >
                          <RefreshCw className="h-3 w-3" /> Retry
                        </Button>
                      )}
                      {draft.syncStatus === 'failed' || draft.syncStatus === 'conflict' ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDelete(draft.id)}
                        >
                          <Trash2 className="h-3 w-3 text-status-error-text" />
                        </Button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setExpandedDraft(isExpanded ? null : draft.id)}
                        className="p-1 text-ink-300 hover:text-ink-500 transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-border space-y-3">
                      {draft.syncError && (
                        <div className="rounded-[6px] bg-status-error-bg/30 px-3 py-2 text-xs text-status-error-text">
                          <p className="font-medium">Error:</p>
                          <p className="mt-0.5">{draft.syncError}</p>
                        </div>
                      )}
                      <div className="space-y-1 text-xs text-ink-500">
                        <p><span className="font-medium text-ink-700">Draft ID:</span> {draft.id}</p>
                        <p><span className="font-medium text-ink-700">Created:</span> {new Date(draft.createdAt).toLocaleString()}</p>
                        <p><span className="font-medium text-ink-700">Last Modified:</span> {new Date(draft.updatedAt).toLocaleString()}</p>
                        {draft.tenantId && <p><span className="font-medium text-ink-700">Tenant:</span> {draft.tenantId}</p>}
                        {draft.userId && <p><span className="font-medium text-ink-700">User:</span> {draft.userId}</p>}
                      </div>
                      {draft.syncStatus === 'conflict' && (
                        <div className="rounded-[6px] bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                          <p className="font-medium">Conflict Resolution</p>
                          <p className="mt-0.5">This draft conflicted with server data. You can either:</p>
                          <ul className="mt-1 list-disc list-inside space-y-0.5">
                            <li>
                              <button
                                type="button"
                                onClick={() => handleRetry(draft.id)}
                                className="font-medium text-brand-700 hover:underline"
                              >
                                Retry sync
                              </button>
                              {' '}— overwrite server data with this draft
                            </li>
                            <li>
                              <button
                                type="button"
                                onClick={() => handleDelete(draft.id)}
                                className="font-medium text-status-error-text hover:underline"
                              >
                                Discard draft
                              </button>
                              {' '}— keep server data and remove this draft
                            </li>
                          </ul>
                        </div>
                      )}
                      {draft.syncStatus === 'failed' && (
                        <div className="flex gap-2">
                          <Button variant="secondary" size="sm" onClick={() => handleRetry(draft.id)}>
                            <RefreshCw className="h-3 w-3" /> Retry Sync
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => handleDelete(draft.id)}>
                            <Trash2 className="h-3 w-3" /> Discard
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
