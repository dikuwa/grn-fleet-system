/* eslint-disable react/no-unescaped-entities */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArchiveRestore,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  HardDriveDownload,
  LockKeyhole,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UnlockKeyhole,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';

interface TenantOption {
  id: string;
  name: string;
  code: string;
  status: string;
  type: string;
}
interface BackupItem {
  id: string;
  scope: string;
  tenantId: string | null;
  tenantName: string | null;
  tenantCode: string | null;
  resetRequestId: string | null;
  source: string;
  reason: string | null;
  status: string;
  sizeBytes: number | null;
  recordCount: number;
  retentionDays: number;
  expiresAt: string | null;
  isProtected: boolean;
  restoredAt: string | null;
  failureReason: string | null;
  createdAt: string;
}
interface ScheduleItem {
  id: string;
  tenantId: string | null;
  tenantName: string | null;
  frequency: string;
  retentionDays: number;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
}
type BackupView = 'current' | 'history';

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NA', { dateStyle: 'medium', timeStyle: 'short' });
}
function formatBytes(value: number | null) {
  if (!value) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PlatformBackupsPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [storageConfigured, setStorageConfigured] = useState(false);
  const [view, setView] = useState<BackupView>('current');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 1 });
  const [backupCounts, setBackupCounts] = useState({
    current: 0,
    history: 0,
    ready: 0,
    protected: 0,
  });
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [tenantId, setTenantId] = useState('');
  const [reason, setReason] = useState('Manual recovery point before platform maintenance');
  const [retentionDays, setRetentionDays] = useState('30');
  const [scheduleTenantId, setScheduleTenantId] = useState('all');
  const [frequency, setFrequency] = useState('monthly');
  const [scheduleRetentionDays, setScheduleRetentionDays] = useState('90');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [backupRes, tenantRes] = await Promise.all([
        fetch(`/api/platform/backups?view=${view}&page=${page}&limit=20`, { cache: 'no-store' }),
        fetch('/api/platform/tenants?limit=100', { cache: 'no-store' }),
      ]);
      const backupJson = await backupRes.json();
      const tenantJson = await tenantRes.json();
      if (!backupRes.ok) throw new Error(backupJson.error || 'Failed to load backups');
      if (!tenantRes.ok) throw new Error(tenantJson.error || 'Failed to load tenants');
      const nextPagination = backupJson.data?.pagination ?? {
        page: 1,
        total: 0,
        totalPages: 1,
      };
      if (page > nextPagination.totalPages) {
        setPage(nextPagination.totalPages);
        return;
      }
      setBackups(backupJson.data?.backups ?? []);
      setPagination(nextPagination);
      setBackupCounts(
        backupJson.data?.counts ?? { current: 0, history: 0, ready: 0, protected: 0 },
      );
      setSchedules(backupJson.data?.schedules ?? []);
      setStorageConfigured(Boolean(backupJson.data?.storageConfigured));
      const tenantRows = (tenantJson.data?.tenants ?? []) as TenantOption[];
      setTenants(tenantRows.filter((tenant) => tenant.type !== 'demo_sandbox'));
      setTenantId(
        (current) =>
          current || tenantRows.find((tenant) => tenant.type !== 'demo_sandbox')?.id || '',
      );
    } catch (error) {
      toast({
        title: 'Could not load Backup & Restore Centre',
        description: error instanceof Error ? error.message : 'Load failed',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [page, toast, view]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const createManual = async () => {
    if (!tenantId) return;
    setProcessing('manual');
    try {
      const res = await fetch('/api/platform/backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, reason, retentionDays: Number(retentionDays) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Backup creation failed');
      toast({
        title: 'Recovery point created',
        description: `${json.data.recordCount} operational records archived to durable storage.`,
        variant: 'success',
      });
      setManualOpen(false);
      await load();
    } catch (error) {
      toast({
        title: 'Recovery point failed',
        description: error instanceof Error ? error.message : 'Backup failed',
        variant: 'error',
      });
    } finally {
      setProcessing(null);
    }
  };

  const createSchedule = async () => {
    setProcessing('schedule');
    try {
      const res = await fetch('/api/platform/backups/schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: scheduleTenantId === 'all' ? null : scheduleTenantId,
          frequency,
          retentionDays: Number(scheduleRetentionDays),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Schedule creation failed');
      toast({ title: 'Backup schedule created', variant: 'success' });
      setScheduleOpen(false);
      await load();
    } catch (error) {
      toast({
        title: 'Could not create schedule',
        description: error instanceof Error ? error.message : 'Schedule failed',
        variant: 'error',
      });
    } finally {
      setProcessing(null);
    }
  };

  const toggleSchedule = async (schedule: ScheduleItem) => {
    setProcessing(schedule.id);
    try {
      const res = await fetch('/api/platform/backups/schedules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: schedule.id, enabled: !schedule.enabled }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Schedule update failed');
      toast({
        title: schedule.enabled ? 'Schedule paused' : 'Schedule enabled',
        variant: 'success',
      });
      await load();
    } catch (error) {
      toast({
        title: 'Schedule update failed',
        description: error instanceof Error ? error.message : 'Update failed',
        variant: 'error',
      });
    } finally {
      setProcessing(null);
    }
  };

  const download = async (backup: BackupItem) => {
    setProcessing(backup.id);
    try {
      const res = await fetch(`/api/platform/backups/${backup.id}/download`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Download link unavailable');
      window.open(json.data.url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      toast({
        title: 'Could not open backup',
        description: error instanceof Error ? error.message : 'Download failed',
        variant: 'error',
      });
    } finally {
      setProcessing(null);
    }
  };

  const protect = async (backup: BackupItem) => {
    setProcessing(backup.id);
    try {
      const res = await fetch(`/api/platform/backups/${backup.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isProtected: !backup.isProtected }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Protection update failed');
      toast({
        title: backup.isProtected ? 'Backup can expire normally' : 'Backup protected from expiry',
        variant: 'success',
      });
      await load();
    } catch (error) {
      toast({
        title: 'Could not update backup',
        description: error instanceof Error ? error.message : 'Update failed',
        variant: 'error',
      });
    } finally {
      setProcessing(null);
    }
  };

  const requestRestore = (backup: BackupItem) => {
    const platformBackup = backup.scope === 'platform_operational';
    if (!platformBackup && !backup.tenantCode) return;
    const phrase = platformBackup ? 'RESTORE PLATFORM' : `RESTORE ${backup.tenantCode}`;
    confirm({
      title: `Restore ${platformBackup ? 'platform operations' : backup.tenantName || backup.tenantCode} from this recovery point?`,
      description: platformBackup
        ? 'Restore is allowed only when no current disposable platform operational records exist. The archive checksum is verified before restoration.'
        : 'Restore is allowed only when the tenant has no current operational records. Existing tenant configuration, staff, users, roles and vehicles are preserved. The backup checksum is verified before restoration.',
      confirmLabel: 'Restore backup',
      variant: 'destructive',
      requireTypedConfirm: phrase,
      onConfirm: async () => {
        setProcessing(backup.id);
        try {
          const res = await fetch(`/api/platform/backups/${backup.id}/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmationPhrase: phrase }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Restore failed');
          toast({
            title: platformBackup
              ? 'Platform operational data restored'
              : 'Tenant operational data restored',
            description: `${json.data.recordsRestored} records restored.`,
            variant: 'success',
          });
          await load();
        } catch (error) {
          toast({
            title: 'Restore blocked or failed',
            description: error instanceof Error ? error.message : 'Restore failed',
            variant: 'error',
          });
        } finally {
          setProcessing(null);
        }
      },
    });
  };

  const requestDelete = (backup: BackupItem) => {
    confirm({
      title: 'Delete this recovery point?',
      description:
        backup.isProtected && backup.status === 'ready'
          ? 'This backup is protected. Unprotect it before deletion.'
          : 'The durable archive will be removed. This does not delete the tenant or any live tenant records.',
      confirmLabel: 'Delete backup',
      variant: 'destructive',
      onConfirm: async () => {
        setProcessing(backup.id);
        try {
          const res = await fetch(`/api/platform/backups/${backup.id}`, { method: 'DELETE' });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Delete failed');
          toast({ title: 'Recovery point deleted', variant: 'success' });
          await load();
        } catch (error) {
          toast({
            title: 'Could not delete backup',
            description: error instanceof Error ? error.message : 'Delete failed',
            variant: 'error',
          });
        } finally {
          setProcessing(null);
        }
      },
    });
  };

  const readyCount = backupCounts.ready;
  const protectedCount = backupCounts.protected;
  const scheduledCount = schedules.filter((schedule) => schedule.enabled).length;
  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === tenantId),
    [tenantId, tenants],
  );

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Backup & Restore' }]}
      />
      <PageHeader
        title="Backup & Restore Centre"
        description="Create durable tenant recovery points, configure recurring protection and restore operational data safely."
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setManualOpen(true)} disabled={!storageConfigured}>
            <HardDriveDownload className="h-4 w-4" /> Create recovery point
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setScheduleOpen(true)}
            disabled={!storageConfigured}
          >
            <CalendarClock className="h-4 w-4" /> Add schedule
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/platform/reset">Reset & Cleanup</Link>
          </Button>
        </div>
      </PageHeader>

      <section
        className={`rounded-[10px] border p-4 ${storageConfigured ? 'border-status-success-text/20 bg-status-success-bg/20' : 'border-status-warning-text/20 bg-status-warning-bg/20'}`}
      >
        <div className="flex items-start gap-3">
          {storageConfigured ? (
            <CheckCircle2 className="text-status-success-text mt-0.5 h-5 w-5" />
          ) : (
            <Cloud className="text-status-warning-text mt-0.5 h-5 w-5" />
          )}
          <div>
            <p className="text-ink-950 text-sm font-semibold">
              {storageConfigured
                ? 'Durable backup storage ready'
                : 'Durable backup storage not configured'}
            </p>
            <p className="text-ink-600 mt-1 text-xs leading-relaxed">
              {storageConfigured
                ? 'Recovery archives are stored outside Postgres in the configured R2/S3-compatible bucket. Production reset execution requires a verified pre-reset recovery point.'
                : 'Configure the existing R2/S3 storage environment variables before using production reset or scheduled backups. Reset execution remains safely blocked until storage is ready.'}
            </p>
          </div>
        </div>
      </section>

      <section aria-label="Backup summary" className="grid gap-3 sm:grid-cols-3">
        {[
          ['Ready recovery points', readyCount, HardDriveDownload],
          ['Protected', protectedCount, ShieldCheck],
          ['Active schedules', scheduledCount, CalendarClock],
        ].map(([label, value, Icon]) => {
          const MetricIcon = Icon as typeof HardDriveDownload;
          return (
            <div key={String(label)} className="border-border bg-surface rounded-[10px] border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-brand-700 dark:text-brand-300 text-2xl font-semibold tabular-nums">
                    {Number(value)}
                  </p>
                  <p className="text-ink-700 mt-1 text-sm font-medium">{String(label)}</p>
                </div>
                <div className="bg-brand-50 text-brand-700 dark:bg-brand-950/40 dark:text-brand-300 flex h-10 w-10 items-center justify-center rounded-[9px]">
                  <MetricIcon className="h-5 w-5" />
                </div>
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-ink-950 text-base font-semibold">Recovery points</h2>
            <p className="text-ink-500 text-xs">
              Application-level tenant operational archives. Database-provider point-in-time
              recovery remains a separate infrastructure safeguard.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => void load()} loading={loading}>
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
        <FilterTabs
          items={[
            { value: 'current', label: 'Current & protected', count: backupCounts.current },
            { value: 'history', label: 'Archived & failed', count: backupCounts.history },
          ]}
          value={view}
          onValueChange={(nextView) => {
            setView(nextView);
            setPage(1);
          }}
          label="Recovery point view"
        />
        {loading ? (
          <div className="text-ink-500 py-12 text-center text-sm">Loading recovery points…</div>
        ) : backups.length === 0 ? (
          <EmptyState
            icon={<ArchiveRestore className="h-6 w-6" />}
            title={
              view === 'history' ? 'No archived recovery points' : 'No current recovery points'
            }
            description={
              view === 'history'
                ? 'Deleted, expired and failed recovery attempts will appear here for governance review.'
                : 'Create a manual recovery point or add a recurring backup schedule.'
            }
          />
        ) : (
          <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
            {backups.map((backup) => (
              <article
                key={backup.id}
                className="border-border grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ink-950 text-sm font-semibold">
                      {backup.tenantName || 'Tenant unavailable'}
                    </p>
                    <Badge
                      variant={
                        backup.status === 'ready'
                          ? 'success'
                          : backup.status === 'failed'
                            ? 'error'
                            : 'default'
                      }
                      size="sm"
                    >
                      {backup.status}
                    </Badge>
                    <Badge variant="default" size="sm">
                      {backup.source.replace(/_/g, ' ')}
                    </Badge>
                    {backup.isProtected && (
                      <Badge variant="info" size="sm">
                        protected
                      </Badge>
                    )}
                    {backup.restoredAt && (
                      <Badge variant="warning" size="sm">
                        restored
                      </Badge>
                    )}
                  </div>
                  <p className="text-ink-500 mt-1 text-xs">
                    {backup.reason || 'Recovery point'} · {backup.recordCount} records ·{' '}
                    {formatBytes(backup.sizeBytes)} · created {formatDate(backup.createdAt)}
                  </p>
                  <p className="text-ink-400 mt-1 text-xs">
                    {backup.isProtected
                      ? 'Protected from automatic expiry'
                      : `Expires ${formatDate(backup.expiresAt)}`}
                    {backup.failureReason ? ` · ${backup.failureReason}` : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {backup.status === 'ready' && (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void download(backup)}
                        loading={processing === backup.id}
                      >
                        <Download className="h-4 w-4" /> Download
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void protect(backup)}
                        disabled={processing === backup.id}
                      >
                        {backup.isProtected ? (
                          <UnlockKeyhole className="h-4 w-4" />
                        ) : (
                          <LockKeyhole className="h-4 w-4" />
                        )}
                        {backup.isProtected ? 'Unprotect' : 'Protect'}
                      </Button>
                      {!backup.restoredAt && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => requestRestore(backup)}
                          disabled={processing === backup.id}
                        >
                          <ArchiveRestore className="h-4 w-4" /> Restore
                        </Button>
                      )}
                    </>
                  )}
                  {backup.status !== 'deleted' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-status-error-text"
                      onClick={() => requestDelete(backup)}
                      disabled={
                        (backup.isProtected && backup.status === 'ready') ||
                        processing === backup.id
                      }
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {pagination.totalPages > 1 && (
          <nav
            className="flex items-center justify-between gap-3"
            aria-label="Recovery point pagination"
          >
            <p className="text-ink-500 text-xs">
              Page {pagination.page} of {pagination.totalPages} · {pagination.total} records
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((current) => Math.max(1, current - 1))}
                disabled={page <= 1 || loading}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setPage((current) => Math.min(pagination.totalPages, current + 1))}
                disabled={page >= pagination.totalPages || loading}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </nav>
        )}
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-ink-950 text-base font-semibold">Recurring protection</h2>
          <p className="text-ink-500 text-xs">
            The daily policy runner creates backups only when each schedule is due.
          </p>
        </div>
        {schedules.length === 0 ? (
          <div className="border-border text-ink-500 rounded-[10px] border border-dashed p-5 text-sm">
            No recurring schedules configured.
          </div>
        ) : (
          <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
            {schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="border-border flex flex-col gap-3 border-b px-4 py-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ink-950 text-sm font-semibold">
                      {schedule.tenantName || 'All active non-demo tenants'}
                    </p>
                    <Badge variant={schedule.enabled ? 'success' : 'default'} size="sm">
                      {schedule.enabled ? 'enabled' : 'paused'}
                    </Badge>
                  </div>
                  <p className="text-ink-500 mt-1 text-xs capitalize">
                    {schedule.frequency} · retain {schedule.retentionDays} days · next{' '}
                    {formatDate(schedule.nextRunAt)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void toggleSchedule(schedule)}
                  loading={processing === schedule.id}
                >
                  {schedule.enabled ? 'Pause' : 'Enable'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Create recovery point</DialogTitle>
            <DialogDescription>
              Creates a durable JSON archive of the operational records that a standard tenant reset
              would remove. Tenant configuration, users, staff, roles and vehicles are not copied
              because the reset preserves them.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Tenant</Label>
              <StyledSelect value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.code})
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Retention</Label>
              <StyledSelect
                value={retentionDays}
                onChange={(event) => setRetentionDays(event.target.value)}
              >
                <option value="7">7 days</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </StyledSelect>
            </div>
            {selectedTenant && (
              <p className="text-ink-500 text-xs">
                Selected: {selectedTenant.name} · tenant code {selectedTenant.code}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setManualOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createManual()}
              loading={processing === 'manual'}
              disabled={!tenantId || !storageConfigured}
            >
              <HardDriveDownload className="h-4 w-4" /> Create recovery point
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add backup schedule</DialogTitle>
            <DialogDescription>
              Recurring logical recovery points supplement your database provider's own
              point-in-time recovery. Demo sandboxes are excluded from all-tenant schedules.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <StyledSelect
                value={scheduleTenantId}
                onChange={(event) => setScheduleTenantId(event.target.value)}
              >
                <option value="all">All active non-demo tenants</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} ({tenant.code})
                  </option>
                ))}
              </StyledSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Frequency</Label>
              <StyledSelect
                value={frequency}
                onChange={(event) => setFrequency(event.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </StyledSelect>
            </div>
            <div className="space-y-1.5">
              <Label>Retention</Label>
              <StyledSelect
                value={scheduleRetentionDays}
                onChange={(event) => setScheduleRetentionDays(event.target.value)}
              >
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="365">1 year</option>
              </StyledSelect>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setScheduleOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createSchedule()}
              loading={processing === 'schedule'}
              disabled={!storageConfigured}
            >
              <Plus className="h-4 w-4" /> Add schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {confirmDialog}
    </div>
  );
}
