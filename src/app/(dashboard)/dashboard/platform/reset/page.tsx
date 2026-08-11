'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArchiveRestore,
  CheckCircle2,
  Database,
  Eye,
  HardDriveDownload,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge, type BadgeProps } from '@/components/ui/badge';
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
import { Input, Label, Textarea } from '@/components/ui/input';
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
interface ResetPreview {
  dryRunSummary: {
    requests: number;
    trips: number;
    documents: number;
    notifications: number;
    total: number;
  };
  steps: Array<{ table: string; label: string; planned: number }>;
  preserved: Array<{ table: string; label: string; count: number }>;
  review: Array<{ table: string; label: string; reason: string; count: number }>;
  fingerprint: string;
  plannedAt: string;
}
interface ResetRequest {
  id: string;
  tenantId: string;
  tenantName: string | null;
  tenantCode: string | null;
  scope: string;
  reason: string;
  status: string;
  requestedByUserId: string;
  requestedByName: string | null;
  requestedByEmail: string | null;
  backupRequired: boolean;
  backupCreated: boolean;
  backupLocation: string | null;
  backupSizeBytes: number | null;
  backupRecordCount: number | null;
  validationResults: ResetPreview | null;
  rollbackPossible: boolean;
  rollbackPerformed: boolean;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  executionTimeMs: number | null;
  reviewNotes: string | null;
  metadata: Record<string, unknown> | null;
}
interface ResetStats {
  total: number;
  draft: number;
  pendingReview: number;
  approved: number;
  completed: number;
  failed: number;
}
interface ResetStep {
  id?: string;
  stepName: string;
  tableName: string;
  recordsDeleted: number;
  recordsPreserved?: number;
  status: string;
  error?: string | null;
}

type StatusConfig = { label: string; variant: BadgeProps['variant'] };
const STATUS_CONFIG: Record<string, StatusConfig> = {
  draft: { label: 'Draft', variant: 'default' },
  pending_review: { label: 'Pending review', variant: 'warning' },
  approved: { label: 'Approved', variant: 'info' },
  in_progress: { label: 'In progress', variant: 'warning' },
  completed: { label: 'Completed', variant: 'success' },
  failed: { label: 'Failed', variant: 'error' },
  cancelled: { label: 'Cancelled', variant: 'default' },
  rejected: { label: 'Rejected', variant: 'error' },
};

function formatDate(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NA', { dateStyle: 'medium', timeStyle: 'short' });
}
function formatBytes(value: number | null) {
  if (!value) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PlatformResetPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [requests, setRequests] = useState<ResetRequest[]>([]);
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [stats, setStats] = useState<ResetStats>({
    total: 0,
    draft: 0,
    pendingReview: 0,
    approved: 0,
    completed: 0,
    failed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<ResetRequest | null>(null);
  const [steps, setSteps] = useState<ResetStep[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reviewNotes, setReviewNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [createTenantId, setCreateTenantId] = useState('');
  const [createTarget, setCreateTarget] = useState<'tenant' | 'platform'>('tenant');
  const [createReason, setCreateReason] = useState(
    'Clear test operational records and start this tenant from a clean operational state.',
  );
  const openedFromNotificationRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('q', search.trim());
      if (status) params.set('status', status);
      const [resetRes, tenantRes] = await Promise.all([
        fetch(`/api/platform/reset?${params}`, { cache: 'no-store' }),
        fetch('/api/platform/tenants?limit=100', { cache: 'no-store' }),
      ]);
      const resetJson = await resetRes.json();
      const tenantJson = await tenantRes.json();
      if (!resetRes.ok) throw new Error(resetJson.error || 'Failed to load reset requests');
      if (!tenantRes.ok) throw new Error(tenantJson.error || 'Failed to load tenants');
      setRequests(resetJson.data?.requests ?? []);
      setStats((current) => resetJson.data?.stats ?? current);
      const tenantRows = (tenantJson.data?.tenants ?? []) as TenantOption[];
      const realTenants = tenantRows.filter((tenant) => tenant.type !== 'demo_sandbox');
      setTenants(realTenants);
      setCreateTenantId((current) => current || realTenants[0]?.id || '');
    } catch (error) {
      toast({
        title: 'Could not load Data Protection',
        description: error instanceof Error ? error.message : 'Load failed',
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  }, [search, status, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openDetails = useCallback(
    async (request: ResetRequest) => {
      setSelected(request);
      setSteps([]);
      setReviewNotes(request.reviewNotes ?? '');
      setRejectionReason('');
      setDetailOpen(true);
      try {
        const res = await fetch(`/api/platform/reset/${request.id}`, { cache: 'no-store' });
        const json = await res.json();
        if (res.ok) {
          setSelected((json.data?.request ?? request) as ResetRequest);
          setSteps(json.data?.steps ?? []);
        }
      } catch {
        toast({ title: 'Some reset details could not be loaded', variant: 'error' });
      }
    },
    [toast],
  );

  useEffect(() => {
    const requestId = new URLSearchParams(window.location.search).get('request');
    if (!requestId || openedFromNotificationRef.current === requestId) return;
    const target = requests.find((request) => request.id === requestId);
    if (!target) return;
    openedFromNotificationRef.current = requestId;
    const timer = window.setTimeout(() => void openDetails(target), 0);
    return () => window.clearTimeout(timer);
  }, [openDetails, requests]);

  const createReset = async () => {
    if ((createTarget === 'tenant' && !createTenantId) || !createReason.trim()) return;
    setProcessingId('create');
    try {
      const res = await fetch('/api/platform/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target: createTarget,
          tenantId: createTarget === 'tenant' ? createTenantId : undefined,
          scope: 'operational',
          reason: createReason.trim(),
          backupRequired: true,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create reset request');
      toast({
        title:
          createTarget === 'platform'
            ? `${json.data.createdCount} tenant reset drafts created`
            : 'Operational reset drafted',
        description:
          'Each tenant must pass review, dry run, and verified recovery-point checks before execution.',
        variant: 'success',
      });
      setCreateOpen(false);
      await load();
    } catch (error) {
      toast({
        title: 'Could not create reset request',
        description: error instanceof Error ? error.message : 'Create failed',
        variant: 'error',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const patchRequest = async (request: ResetRequest, action: 'submit' | 'approve' | 'reject') => {
    setProcessingId(request.id);
    try {
      const res = await fetch(`/api/platform/reset/${request.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reviewNotes,
          reason: action === 'reject' ? rejectionReason : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `${action} failed`);
      toast({
        title:
          action === 'submit'
            ? 'Reset submitted for review'
            : action === 'approve'
              ? 'Reset approved'
              : 'Reset rejected',
        variant: 'success',
      });
      setDetailOpen(false);
      setSelected(null);
      await load();
    } catch (error) {
      toast({
        title: 'Reset workflow update failed',
        description: error instanceof Error ? error.message : 'Update failed',
        variant: 'error',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const runDryRun = async (request: ResetRequest) => {
    setProcessingId(request.id);
    try {
      const res = await fetch(`/api/platform/reset/${request.id}/dry-run`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Dry run failed');
      toast({
        title: 'Dry run complete',
        description: `${json.data.dryRunSummary.total} rows are in the reset plan. No live data was changed.`,
        variant: 'success',
      });
      await load();
      const refreshed = await fetch(`/api/platform/reset/${request.id}`, {
        cache: 'no-store',
      }).then((response) => response.json());
      if (refreshed.data?.request) setSelected(refreshed.data.request as ResetRequest);
    } catch (error) {
      toast({
        title: 'Dry run failed',
        description: error instanceof Error ? error.message : 'Dry run failed',
        variant: 'error',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const createRecoveryPoint = async (request: ResetRequest) => {
    setProcessingId(request.id);
    try {
      const res = await fetch(`/api/platform/reset/${request.id}/backup`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Recovery point creation failed');
      toast({
        title: 'Recovery point verified',
        description: `${json.data.recordCount} records archived to durable storage.`,
        variant: 'success',
      });
      await load();
      const refreshed = await fetch(`/api/platform/reset/${request.id}`, {
        cache: 'no-store',
      }).then((response) => response.json());
      if (refreshed.data?.request) setSelected(refreshed.data.request as ResetRequest);
    } catch (error) {
      toast({
        title: 'Recovery point not ready',
        description: error instanceof Error ? error.message : 'Backup failed',
        variant: 'error',
      });
    } finally {
      setProcessingId(null);
    }
  };

  const requestExecution = (request: ResetRequest) => {
    if (!request.tenantCode || !request.backupCreated || !request.validationResults) return;
    const phrase = `RESET ${request.tenantCode}`;
    setDetailOpen(false);
    confirm({
      title: `Reset operational data for ${request.tenantName || request.tenantCode}?`,
      description: `This removes only the operational rows shown in the dry run. Tenant, staff, users, roles, vehicles, offices/departments, programmes, workflow configuration and audit history remain. A verified recovery point must remain available. Type ${phrase} to continue.`,
      confirmLabel: 'Execute operational reset',
      variant: 'destructive',
      requireTypedConfirm: phrase,
      onConfirm: async () => {
        setProcessingId(request.id);
        try {
          const res = await fetch(`/api/platform/reset/${request.id}/execute`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ confirmationPhrase: phrase }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Reset execution failed');
          toast({
            title: 'Operational reset complete',
            description: `${json.data.totalRemoved} operational rows were removed. The tenant and its master data were preserved.`,
            variant: 'success',
          });
          await load();
        } catch (error) {
          toast({
            title: 'Reset blocked or failed',
            description: error instanceof Error ? error.message : 'Execution failed',
            variant: 'error',
          });
        } finally {
          setProcessingId(null);
        }
      },
    });
  };

  const selectedTenant = useMemo(
    () => tenants.find((tenant) => tenant.id === createTenantId),
    [createTenantId, tenants],
  );
  const preview = selected?.validationResults ?? null;
  const canExecute = Boolean(
    selected?.status === 'approved' &&
    selected?.scope === 'operational' &&
    preview?.fingerprint &&
    selected?.backupCreated &&
    selected?.rollbackPossible,
  );
  const legacyUnsupported = Boolean(selected && selected.scope !== 'operational');

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Reset & Cleanup' }]}
      />
      <PageHeader
        title="Reset & Cleanup"
        description="Return a tenant to a clean operational starting point without deleting its organisation, users, staff, roles, vehicles or configuration."
      >
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> New operational reset
          </Button>
          <Button variant="secondary" size="sm" asChild>
            <Link href="/dashboard/platform/backups">
              <ArchiveRestore className="h-4 w-4" /> Backup & Restore
            </Link>
          </Button>
        </div>
      </PageHeader>

      <section className="border-status-warning-text/20 bg-status-warning-bg/20 rounded-[10px] border p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-status-warning-text mt-0.5 h-5 w-5" />
          <div>
            <p className="text-ink-950 text-sm font-semibold">Reset never deletes the tenant</p>
            <p className="text-ink-600 mt-1 text-xs leading-relaxed">
              The production-safe operational preset clears requests, workflows, allocations, trips,
              logs, fuel, inspections, operational documents, defects and related notifications.
              Tenant deletion remains a completely separate action in Tenant Management.
            </p>
          </div>
        </div>
      </section>

      <section
        aria-label="Reset summary"
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6"
      >
        {[
          ['Total', stats.total, 'text-ink-950'],
          ['Draft', stats.draft, 'text-ink-700'],
          ['Pending', stats.pendingReview, 'text-status-warning-text'],
          ['Approved', stats.approved, 'text-status-info-text'],
          ['Completed', stats.completed, 'text-status-success-text'],
          ['Failed', stats.failed, 'text-status-error-text'],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="border-border bg-surface rounded-[10px] border p-4">
            <p className={`text-2xl font-semibold tabular-nums ${tone}`}>{Number(value)}</p>
            <p className="text-ink-500 mt-1 text-xs">{String(label)}</p>
          </div>
        ))}
      </section>

      <section className="border-border grid gap-3 border-y py-4 sm:grid-cols-[minmax(0,1fr)_200px_auto]">
        <div className="relative">
          <Search className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
            placeholder="Search tenant, code or reason…"
          />
        </div>
        <StyledSelect value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {Object.entries(STATUS_CONFIG).map(([value, config]) => (
            <option key={value} value={value}>
              {config.label}
            </option>
          ))}
        </StyledSelect>
        <Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </section>

      {loading ? (
        <div className="text-ink-500 flex min-h-48 items-center justify-center gap-2 text-sm">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> Loading reset
          requests…
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          icon={<Database className="h-6 w-6" />}
          title="No reset requests"
          description="Create an operational reset when a tenant needs a clean operational starting point."
          action={{ label: 'New operational reset', onClick: () => setCreateOpen(true) }}
        />
      ) : (
        <div className="border-border bg-surface overflow-hidden rounded-[10px] border">
          {requests.map((request) => {
            const config = STATUS_CONFIG[request.status] ?? {
              label: request.status,
              variant: 'default' as const,
            };
            const tenantOrigin = request.metadata?.createdFrom === 'tenant_admin';
            return (
              <article
                key={request.id}
                className="border-border grid gap-4 border-b px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-ink-950 text-sm font-semibold">
                      {request.tenantName || request.tenantId}
                    </p>
                    <Badge variant={config.variant} size="sm">
                      {config.label}
                    </Badge>
                    <Badge variant={request.scope === 'operational' ? 'info' : 'warning'} size="sm">
                      {request.scope.replace(/_/g, ' ')}
                    </Badge>
                    {tenantOrigin && (
                      <Badge variant="warning" size="sm">
                        Tenant requested
                      </Badge>
                    )}
                    {request.backupCreated && (
                      <Badge variant="success" size="sm">
                        recovery point ready
                      </Badge>
                    )}
                  </div>
                  <p className="text-ink-600 mt-1 line-clamp-2 text-sm">{request.reason}</p>
                  <p className="text-ink-400 mt-2 text-xs">
                    {tenantOrigin
                      ? `Requested by ${request.requestedByName || request.requestedByEmail || 'Tenant Administrator'}`
                      : 'Created by Platform Administrator'}{' '}
                    · {formatDate(request.createdAt)}
                    {request.validationResults?.dryRunSummary
                      ? ` · dry run ${request.validationResults.dryRunSummary.total} rows`
                      : ''}
                    {request.rollbackPerformed ? ' · restored from recovery point' : ''}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button variant="secondary" size="sm" onClick={() => void openDetails(request)}>
                    <Eye className="h-4 w-4" /> Details
                  </Button>
                  {request.status === 'draft' && (
                    <Button
                      size="sm"
                      onClick={() => void patchRequest(request, 'submit')}
                      loading={processingId === request.id}
                    >
                      Submit
                    </Button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Start operational reset</DialogTitle>
            <DialogDescription>
              This creates controlled reset requests. Nothing is deleted until each tenant passes
              review, dry run, durable recovery-point verification and typed final confirmation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Target</Label>
              <StyledSelect
                value={createTarget}
                onChange={(event) => setCreateTarget(event.target.value as 'tenant' | 'platform')}
              >
                <option value="tenant">One tenant</option>
                <option value="platform">All production tenants</option>
              </StyledSelect>
            </div>
            {createTarget === 'tenant' && (
              <div className="space-y-1.5">
                <Label>Tenant</Label>
                <StyledSelect
                  value={createTenantId}
                  onChange={(event) => setCreateTenantId(event.target.value)}
                >
                  {tenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>
                      {tenant.name} ({tenant.code})
                    </option>
                  ))}
                </StyledSelect>
              </div>
            )}
            <div className="border-brand-200 bg-brand-50/40 dark:bg-brand-950/20 rounded-[8px] border p-3">
              <p className="text-ink-950 text-sm font-semibold">
                Preset: Start operational data from scratch
              </p>
              <p className="text-ink-600 mt-1 text-xs leading-relaxed">
                Removes transport operations and their generated history. Preserves tenant,
                branding, staff, users, roles, departments/offices, vehicles, programmes, workflow
                definitions and audit history.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                rows={3}
                value={createReason}
                onChange={(event) => setCreateReason(event.target.value)}
              />
            </div>
            {createTarget === 'tenant' && selectedTenant && (
              <p className="text-ink-500 text-xs">
                Final execution confirmation will require:{' '}
                <strong>RESET {selectedTenant.code}</strong>
              </p>
            )}
            {createTarget === 'platform' && (
              <p className="text-ink-500 text-xs">
                A separate draft is created per production tenant. Tenants with an open reset
                request are skipped; no batch executes automatically.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createReset()}
              loading={processingId === 'create'}
              disabled={(createTarget === 'tenant' && !createTenantId) || !createReason.trim()}
            >
              <Database className="h-4 w-4" />{' '}
              {createTarget === 'platform'
                ? 'Create platform reset drafts'
                : 'Create reset request'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={detailOpen}
        onOpenChange={(open) => {
          if (!processingId) {
            setDetailOpen(open);
            if (!open) setSelected(null);
          }
        }}
      >
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>{selected.tenantName || 'Tenant'} reset</DialogTitle>
                  <Badge variant={STATUS_CONFIG[selected.status]?.variant}>
                    {STATUS_CONFIG[selected.status]?.label || selected.status}
                  </Badge>
                </div>
                <DialogDescription>{selected.reason}</DialogDescription>
              </DialogHeader>
              <div className="space-y-5">
                {legacyUnsupported && (
                  <div className="border-status-warning-text/20 bg-status-warning-bg/20 rounded-[8px] border p-3">
                    <div className="flex gap-2">
                      <TriangleAlert className="text-status-warning-text mt-0.5 h-4 w-4" />
                      <p className="text-ink-700 text-sm">
                        This is a legacy <strong>{selected.scope.replace(/_/g, ' ')}</strong>{' '}
                        request. Production execution is disabled. Create a new operational reset
                        request instead.
                      </p>
                    </div>
                  </div>
                )}

                <section className="grid gap-3 sm:grid-cols-3">
                  <div className="border-border rounded-[8px] border p-3">
                    <p className="text-ink-500 text-xs">Tenant code</p>
                    <p className="text-ink-950 mt-1 text-sm font-semibold">
                      {selected.tenantCode || '—'}
                    </p>
                  </div>
                  <div className="border-border rounded-[8px] border p-3">
                    <p className="text-ink-500 text-xs">Dry run</p>
                    <p className="text-ink-950 mt-1 text-sm font-semibold">
                      {preview ? `${preview.dryRunSummary.total} rows` : 'Not run'}
                    </p>
                  </div>
                  <div className="border-border rounded-[8px] border p-3">
                    <p className="text-ink-500 text-xs">Recovery point</p>
                    <p
                      className={`mt-1 text-sm font-semibold ${selected.backupCreated ? 'text-status-success-text' : 'text-ink-950'}`}
                    >
                      {selected.backupCreated ? 'Verified' : 'Required'}
                    </p>
                  </div>
                </section>

                {preview && (
                  <section className="space-y-3">
                    <div>
                      <h3 className="text-ink-950 text-sm font-semibold">Dry-run impact</h3>
                      <p className="text-ink-500 text-xs">
                        Snapshot calculated {formatDate(preview.plannedAt)}. If operational data
                        changes, execution is blocked until you rerun this step.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {Object.entries(preview.dryRunSummary).map(([label, value]) => (
                        <div key={label} className="border-border rounded-[8px] border p-3">
                          <p className="text-ink-500 text-xs capitalize">{label}</p>
                          <p className="text-ink-950 mt-1 text-xl font-semibold tabular-nums">
                            {value}
                          </p>
                        </div>
                      ))}
                    </div>
                    <div className="border-border overflow-hidden rounded-[8px] border">
                      {preview.steps
                        .filter((step) => step.planned > 0)
                        .map((step) => (
                          <div
                            key={step.table}
                            className="border-border flex items-center justify-between gap-3 border-b px-3 py-2.5 last:border-b-0"
                          >
                            <span className="text-ink-700 text-sm">{step.label}</span>
                            <span className="text-ink-950 text-sm font-semibold tabular-nums">
                              {step.planned}
                            </span>
                          </div>
                        ))}
                    </div>
                  </section>
                )}

                {preview && (
                  <section className="border-status-success-text/20 bg-status-success-bg/15 rounded-[8px] border p-4">
                    <h3 className="text-ink-950 text-sm font-semibold">Protected master data</h3>
                    <p className="text-ink-500 mt-1 text-xs">
                      These records are explicitly outside the operational reset.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {[
                        'Tenant & branding',
                        'Staff & users',
                        'Roles & permissions',
                        'Departments & offices',
                        'Vehicles',
                        'Programmes',
                        'Workflow configuration',
                        'Audit history',
                      ].map((label) => (
                        <Badge key={label} variant="success" size="sm">
                          {label}
                        </Badge>
                      ))}
                    </div>
                  </section>
                )}

                {selected.backupCreated && (
                  <section className="border-brand-200 bg-brand-50/40 dark:bg-brand-950/20 rounded-[8px] border p-4">
                    <div className="flex items-start gap-3">
                      <HardDriveDownload className="text-brand-700 dark:text-brand-300 mt-0.5 h-5 w-5" />
                      <div>
                        <p className="text-ink-950 text-sm font-semibold">
                          Durable recovery point ready
                        </p>
                        <p className="text-ink-600 mt-1 text-xs">
                          {selected.backupRecordCount ?? 0} records ·{' '}
                          {formatBytes(selected.backupSizeBytes)}. The archive is retained outside
                          Postgres and can be managed from Backup & Restore.
                        </p>
                      </div>
                    </div>
                  </section>
                )}

                {steps.length > 0 && (
                  <section>
                    <h3 className="text-ink-950 mb-2 text-sm font-semibold">Execution history</h3>
                    <div className="border-border overflow-hidden rounded-[8px] border">
                      {steps.map((step, index) => (
                        <div
                          key={`${step.tableName}-${index}`}
                          className="border-border grid gap-1 border-b px-3 py-2.5 last:border-b-0 sm:grid-cols-[1fr_130px_auto]"
                        >
                          <span className="text-ink-700 text-sm">{step.stepName}</span>
                          <span className="text-ink-400 font-mono text-xs">{step.tableName}</span>
                          <span className="text-ink-500 text-xs">
                            {step.recordsDeleted} removed
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {selected.status === 'pending_review' && (
                  <section className="space-y-3">
                    <div className="space-y-1.5">
                      <Label>Review notes</Label>
                      <Textarea
                        rows={3}
                        value={reviewNotes}
                        onChange={(event) => setReviewNotes(event.target.value)}
                        placeholder="Record why this reset is appropriate after reviewing the impact preview."
                      />
                      <p className="text-ink-400 text-xs">
                        Required for approval and returned to the Tenant Administrator.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Rejection reason</Label>
                      <Input
                        value={rejectionReason}
                        onChange={(event) => setRejectionReason(event.target.value)}
                        placeholder="Required only when rejecting"
                      />
                    </div>
                  </section>
                )}
                {selected.failureReason && (
                  <div className="bg-status-error-bg text-status-error-text rounded-[8px] p-3">
                    <p className="text-sm font-semibold">Previous failure</p>
                    <p className="mt-1 text-xs">{selected.failureReason}</p>
                  </div>
                )}
              </div>
              <DialogFooter className="flex flex-wrap gap-2 sm:gap-2">
                <Button variant="secondary" onClick={() => setDetailOpen(false)}>
                  Close
                </Button>
                {selected.status === 'draft' && (
                  <Button
                    onClick={() => void patchRequest(selected, 'submit')}
                    loading={processingId === selected.id}
                  >
                    Submit for review
                  </Button>
                )}
                {selected.status === 'pending_review' && (
                  <>
                    <Button
                      variant="secondary"
                      className="text-status-error-text"
                      onClick={() => void patchRequest(selected, 'reject')}
                      disabled={rejectionReason.trim().length < 10}
                      loading={processingId === selected.id}
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void runDryRun(selected)}
                      loading={processingId === selected.id}
                    >
                      <Eye className="h-4 w-4" />{' '}
                      {preview ? 'Refresh impact preview' : 'Preview impact'}
                    </Button>
                    <Button
                      onClick={() => void patchRequest(selected, 'approve')}
                      loading={processingId === selected.id}
                      disabled={!preview?.fingerprint || reviewNotes.trim().length < 10}
                    >
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </Button>
                  </>
                )}
                {selected.status === 'approved' && !legacyUnsupported && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => void runDryRun(selected)}
                      loading={processingId === selected.id}
                    >
                      <Eye className="h-4 w-4" /> {preview ? 'Rerun dry run' : 'Run dry run'}
                    </Button>
                    {preview && !selected.backupCreated && (
                      <Button
                        variant="secondary"
                        onClick={() => void createRecoveryPoint(selected)}
                        loading={processingId === selected.id}
                      >
                        <HardDriveDownload className="h-4 w-4" /> Create recovery point
                      </Button>
                    )}
                    {canExecute && (
                      <Button
                        variant="destructive"
                        onClick={() => requestExecution(selected)}
                        disabled={Boolean(processingId)}
                      >
                        <Trash2 className="h-4 w-4" /> Execute reset
                      </Button>
                    )}
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
