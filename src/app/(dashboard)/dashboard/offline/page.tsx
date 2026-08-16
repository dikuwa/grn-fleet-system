'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { syncSingleDraft } from '@/lib/offline-sync';
import { listDrafts, deleteDraft, getDraft } from '@/lib/offline-drafts';
import type { OfflineDraft } from '@/lib/offline-drafts';
import { SystemRoles } from '@/lib/dashboard-access';
import { fetchUserProfile, userProfileQueryKey } from '@/lib/user-profile';
import {
  RefreshCw,
  Database,
  Trash2,
  Eye,
  X,
  AlertTriangle,
  Loader2,
  Clock,
  RotateCcw,
  ShieldAlert,
} from 'lucide-react';

type SyncStatus = 'all' | 'pending' | 'failed' | 'conflict' | 'synced';

const DRAFT_TYPE_LABELS: Record<string, string> = {
  fuel: 'Fuel Transaction',
  request: 'Transport Request',
  trip_log: 'Trip Log Entry',
  trip_progress: 'Trip Progress',
  trip_incident: 'Trip Incident / Defect',
  trip_expense: 'Trip Expense',
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

/**
 * Canonical offline-write capability for the current role set.
 * Drivers may view completed official inspections but must never create or sync
 * official departure/return inspections. Legacy inspection drafts remain
 * visible on this page as read-only recovery records instead of being hidden or
 * silently deleted.
 */
function allowedDraftTypes(roleNames: string[]): OfflineDraft['draftType'][] {
  const allowed = new Set<OfflineDraft['draftType']>();
  if (roleNames.includes(SystemRoles.TRANSPORT_ADMIN)) {
    return [
      'fuel',
      'request',
      'trip_log',
      'trip_progress',
      'trip_incident',
      'trip_expense',
      'inspection_departure',
      'inspection_return',
    ];
  }
  if (roleNames.includes(SystemRoles.REQUESTER)) allowed.add('request');
  if (roleNames.includes(SystemRoles.DRIVER)) {
    ['fuel', 'trip_log', 'trip_progress', 'trip_incident', 'trip_expense'].forEach((type) =>
      allowed.add(type as OfflineDraft['draftType']),
    );
  }
  if (roleNames.includes(SystemRoles.INSPECTOR) || roleNames.includes(SystemRoles.RELEASE_OFFICER)) {
    allowed.add('inspection_departure');
    allowed.add('inspection_return');
  }
  return [...allowed];
}

export default function OfflinePage() {
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: userProfileQueryKey,
    queryFn: ({ signal }) => fetchUserProfile(signal),
  });
  const [drafts, setDrafts] = useState<OfflineDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<SyncStatus>('all');
  const [selectedDraft, setSelectedDraft] = useState<OfflineDraft | null>(null);
  const [summary, setSummary] = useState({ pending: 0, failed: 0, conflict: 0, synced: 0 });

  const allowedTypes = useMemo(() => {
    if (!profile) return new Set<OfflineDraft['draftType']>();
    return new Set(allowedDraftTypes(profile.roles.map((role) => role.roleName)));
  }, [profile]);

  const isSyncAllowed = useCallback(
    (draft: OfflineDraft) => allowedTypes.has(draft.draftType),
    [allowedTypes],
  );

  const loadDrafts = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      // Load every draft owned by this exact account/tenant. Draft-type filtering
      // is applied only to sync actions so legacy records survive role-policy
      // changes and can still be inspected or explicitly discarded by the owner.
      const all = await listDrafts({
        userId: profile.id,
        tenantId: profile.tenantId,
      });
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
  }, [profile]);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadDrafts(), 0);
    return () => window.clearTimeout(timer);
  }, [loadDrafts]);

  const syncableDrafts = useMemo(
    () =>
      drafts.filter(
        (draft) =>
          isSyncAllowed(draft) &&
          (draft.syncStatus === 'pending' || draft.syncStatus === 'failed'),
      ),
    [drafts, isSyncAllowed],
  );
  const legacyDraftCount = useMemo(
    () => drafts.filter((draft) => !isSyncAllowed(draft)).length,
    [drafts, isSyncAllowed],
  );

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const result = { synced: 0, failed: 0, errors: [] as Array<{ id: string; error: string }> };
      for (const draft of syncableDrafts) {
        const itemResult = await syncSingleDraft(draft.id);
        if (itemResult?.synced) result.synced += 1;
        else {
          result.failed += 1;
          result.errors.push({ id: draft.id, error: itemResult?.error || 'Draft not found' });
        }
      }
      await loadDrafts();
      if (result.synced > 0 || result.failed > 0) {
        window.dispatchEvent(new CustomEvent('offline-sync-complete', { detail: result }));
      }
    } finally {
      setSyncing(false);
    }
  };

  const handleRetrySingle = async (draftId: string) => {
    const draft = drafts.find((item) => item.id === draftId);
    if (!draft || !isSyncAllowed(draft)) return;
    setSyncing(true);
    try {
      const itemResult = await syncSingleDraft(draftId);
      await loadDrafts();
      window.dispatchEvent(
        new CustomEvent('offline-sync-complete', {
          detail: {
            synced: itemResult?.synced ? 1 : 0,
            failed: itemResult?.synced ? 0 : 1,
            errors: itemResult?.synced
              ? []
              : [{ id: draftId, error: itemResult?.error || 'Sync failed' }],
          },
        }),
      );
    } finally {
      setSyncing(false);
    }
  };

  const handleDiscard = async (id: string) => {
    if (!drafts.some((draft) => draft.id === id)) return;
    await deleteDraft(id);
    await loadDrafts();
  };

  const handleViewDetail = async (id: string) => {
    if (!drafts.some((draft) => draft.id === id)) return;
    try {
      const draft = await getDraft(id);
      setSelectedDraft(draft ?? null);
    } catch (err) {
      console.error('[Offline] Failed to load draft detail:', err);
    }
  };

  const filteredDrafts =
    statusFilter === 'all' ? drafts : drafts.filter((d) => d.syncStatus === statusFilter);

  const sortedDrafts = [...filteredDrafts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Offline Drafts' }]}
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
          disabled={syncing || syncableDrafts.length === 0}
        >
          <RefreshCw className="h-4 w-4" />
          Sync All
        </Button>
      </PageHeader>

      {legacyDraftCount > 0 && (
        <div className="border-status-pending-bg bg-status-pending-bg/50 flex items-start gap-3 rounded-[10px] border p-4">
          <ShieldAlert className="text-status-pending-text mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="text-ink-950 text-sm font-medium">
              {legacyDraftCount} legacy draft{legacyDraftCount === 1 ? '' : 's'} kept for recovery
            </p>
            <p className="text-ink-600 mt-1 text-xs">
              These drafts were created under an older role capability and are now read-only. They remain visible so no offline work is lost, but they cannot be synced unless the account currently has authority for that record type.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-ink-500 text-xs">Pending</p>
                <p className="text-status-pending-text mt-1 text-2xl font-[650] tabular-nums">
                  {summary.pending}
                </p>
              </div>
              <div className="bg-status-pending-bg flex h-10 w-10 items-center justify-center rounded-full">
                <Clock className="text-status-pending-text h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-ink-500 text-xs">Failed</p>
                <p className="text-status-error-text mt-1 text-2xl font-[650] tabular-nums">
                  {summary.failed}
                </p>
              </div>
              <div className="bg-status-error-bg flex h-10 w-10 items-center justify-center rounded-full">
                <AlertTriangle className="text-status-error-text h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-ink-500 text-xs">Conflicts</p>
                <p className="text-status-error-text mt-1 text-2xl font-[650] tabular-nums">
                  {summary.conflict}
                </p>
              </div>
              <div className="bg-status-error-bg flex h-10 w-10 items-center justify-center rounded-full">
                <AlertTriangle className="text-status-error-text h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-ink-500 text-xs">Total Unsynced</p>
                <p className="text-ink-950 mt-1 text-2xl font-[650] tabular-nums">
                  {summary.pending + summary.failed + summary.conflict}
                </p>
              </div>
              <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-full">
                <Database className="text-ink-500 h-5 w-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'failed', 'conflict', 'synced'] as const).map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            className={`rounded-[8px] px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === status
                ? 'bg-brand-900 text-white dark:bg-brand-800'
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            {statusFilter === 'all' ? 'All Drafts' : `${STATUS_LABELS[statusFilter]} Drafts`}
            <span className="text-ink-500 text-xs font-normal tabular-nums">
              ({sortedDrafts.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading || profileLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="text-ink-400 h-6 w-6 animate-spin" />
            </div>
          ) : sortedDrafts.length === 0 ? (
            <EmptyState
              icon={<Database className="h-6 w-6" />}
              title="No Drafts Found"
              description={
                statusFilter === 'all'
                  ? 'No offline drafts saved yet.'
                  : `No drafts with "${STATUS_LABELS[statusFilter]}" status.`
              }
            />
          ) : (
            <div className="space-y-2">
              {sortedDrafts.map((draft) => {
                const syncAllowed = isSyncAllowed(draft);
                return (
                  <div
                    key={draft.id}
                    className={`rounded-[8px] border p-3 transition-colors ${
                      !syncAllowed
                        ? 'border-status-pending-bg/50 bg-status-pending-bg/10'
                        : draft.syncStatus === 'conflict'
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
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-ink-950 text-sm font-medium">
                            {DRAFT_TYPE_LABELS[draft.draftType] ?? draft.draftType}
                          </p>
                          <Badge variant={STATUS_VARIANTS[draft.syncStatus]} size="sm">
                            {STATUS_LABELS[draft.syncStatus]}
                          </Badge>
                          {!syncAllowed && (
                            <Badge variant="pending" size="sm">
                              Legacy · Read only
                            </Badge>
                          )}
                        </div>
                        <p className="text-ink-500 mt-0.5 text-xs tabular-nums">
                          Updated {new Date(draft.updatedAt).toLocaleString()}
                        </p>
                        {!syncAllowed && (
                          <p className="text-status-pending-text mt-1 max-w-md text-xs">
                            Current role permissions do not allow this draft type to create an official record.
                          </p>
                        )}
                        {draft.syncError && (
                          <p className="text-status-error-text mt-1 max-w-md truncate text-xs">
                            <AlertTriangle className="mr-1 -mt-0.5 inline-block h-3 w-3" />
                            {draft.syncError}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleViewDetail(draft.id)}
                          title="View draft details"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {syncAllowed &&
                          (draft.syncStatus === 'failed' || draft.syncStatus === 'conflict') && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => handleRetrySingle(draft.id)}
                              disabled={syncing}
                              title="Retry sync"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => handleDiscard(draft.id)}
                          className="text-status-error-text hover:bg-status-error-bg/20"
                          title="Discard local draft"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {selectedDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <Card className="max-h-[80vh] w-full max-w-lg overflow-y-auto">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Draft Details</span>
                <button
                  onClick={() => setSelectedDraft(null)}
                  className="text-ink-400 hover:bg-muted hover:text-ink-700 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                  aria-label="Close draft details"
                >
                  <X className="h-4 w-4" />
                </button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!isSyncAllowed(selectedDraft) && (
                <div className="border-status-pending-bg bg-status-pending-bg/40 rounded-[8px] border p-3">
                  <p className="text-status-pending-text text-xs font-medium">Legacy read-only draft</p>
                  <p className="text-ink-700 mt-1 text-xs">
                    This draft is preserved for recovery, but your current workspace no longer has authority to sync this record type.
                  </p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-ink-500 text-xs">Type</p>
                  <p className="text-ink-950 text-sm font-medium">
                    {DRAFT_TYPE_LABELS[selectedDraft.draftType] ?? selectedDraft.draftType}
                  </p>
                </div>
                <div>
                  <p className="text-ink-500 text-xs">Status</p>
                  <Badge
                    variant={STATUS_VARIANTS[selectedDraft.syncStatus]}
                    size="sm"
                    className="mt-0.5"
                  >
                    {STATUS_LABELS[selectedDraft.syncStatus]}
                  </Badge>
                </div>
                <div>
                  <p className="text-ink-500 text-xs">Created</p>
                  <p className="text-ink-950 text-sm tabular-nums">
                    {new Date(selectedDraft.createdAt).toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-ink-500 text-xs">Updated</p>
                  <p className="text-ink-950 text-sm tabular-nums">
                    {new Date(selectedDraft.updatedAt).toLocaleString()}
                  </p>
                </div>
                {selectedDraft.syncedEntityId && (
                  <div className="col-span-2">
                    <p className="text-ink-500 text-xs">Synced Entity ID</p>
                    <p className="text-ink-950 truncate font-mono text-sm">
                      {selectedDraft.syncedEntityId}
                    </p>
                  </div>
                )}
              </div>

              {selectedDraft.syncError && (
                <div className="border-status-error-bg/40 bg-status-error-bg/10 rounded-[8px] border p-3">
                  <p className="text-status-error-text text-xs font-medium">Sync Error</p>
                  <p className="text-ink-700 mt-1 text-sm">{selectedDraft.syncError}</p>
                </div>
              )}

              <div>
                <p className="text-ink-500 mb-2 text-xs">Form Data</p>
                <pre className="bg-muted text-ink-700 max-h-48 overflow-x-auto rounded-[8px] p-3 font-mono text-xs whitespace-pre-wrap">
                  {JSON.stringify(selectedDraft.formData, null, 2)}
                </pre>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="secondary" size="sm" onClick={() => setSelectedDraft(null)}>
                  Close
                </Button>
                {isSyncAllowed(selectedDraft) &&
                  (selectedDraft.syncStatus === 'failed' || selectedDraft.syncStatus === 'conflict') && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleRetrySingle(selectedDraft.id)}
                      loading={syncing}
                      disabled={syncing}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Retry Sync
                    </Button>
                  )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void handleDiscard(selectedDraft.id);
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
