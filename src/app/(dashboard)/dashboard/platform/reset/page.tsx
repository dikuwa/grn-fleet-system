'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArchiveRestore,
  CheckCircle2,
  Clock,
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label, Textarea } from '@/components/ui/input';
import { StyledSelect } from '@/components/ui/styled-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';

interface TenantOption { id: string; name: string; code: string; status: string; type: string; }
interface ResetPreview {
  dryRunSummary: { requests: number; trips: number; documents: number; notifications: number; total: number };
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
}
interface ResetStats { total: number; draft: number; pendingReview: number; approved: number; completed: number; failed: number; }
interface ResetStep { id?: string; stepName: string; tableName: string; recordsDeleted: number; recordsPreserved?: number; status: string; error?: string | null; }

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
  const [stats, setStats] = useState<ResetStats>({ total: 0, draft: 0, pendingReview: 0, approved: 0, completed: 0, failed: 0 });
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
  const [createReason, setCreateReason] = useState('Clear test operational records and start this tenant from a clean operational state.');

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
      setStats(resetJson.data?.stats ?? stats);
      const tenantRows = (tenantJson.data?.tenants ?? []) as TenantOption[];
      const realTenants = tenantRows.filter((tenant) => tenant.type !== 'demo_sandbox');
      setTenants(realTenants);
      setCreateTenantId((current) => current || realTenants[0]?.id || '');
    } catch (error) {
      toast({ title: 'Could not load Data Protection', description: error instanceof Error ? error.message : 'Load failed', variant: 'error' });
    } finally { setLoading(false); }
  }, [search, status, toast]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  const openDetails = async (request: ResetRequest) => {
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
  };

  const createReset = async () => {
    if (!createTenantId || !createReason.trim()) return;
    setProcessingId('create');
    try {
      const res = await fetch('/api/platform/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: createTenantId, scope: 'operational', reason: createReason.trim(), backupRequired: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not create reset request');
      toast({ title: 'Operational reset drafted', description: 'Submit it for review, run a dry run, and create a verified recovery point before execution.', variant: 'success' });
      setCreateOpen(false);
      await load();
    } catch (error) {
      toast({ title: 'Could not create reset request', description: error instanceof Error ? error.message : 'Create failed', variant: 'error' });
    } finally { setProcessingId(null); }
  };

  const patchRequest = async (request: ResetRequest, action: 'submit' | 'approve' | 'reject') => {
    setProcessingId(request.id);
    try {
      const res = await fetch(`/api/platform/reset/${request.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reviewNotes, reason: action === 'reject' ? rejectionReason : undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `${action} failed`);
      toast({ title: action === 'submit' ? 'Reset submitted for review' : action === 'approve' ? 'Reset approved' : 'Reset rejected', variant: 'success' });
      setDetailOpen(false);
      setSelected(null);
      await load();
    } catch (error) {
      toast({ title: 'Reset workflow update failed', description: error instanceof Error ? error.message : 'Update failed', variant: 'error' });
    } finally { setProcessingId(null); }
  };

  const runDryRun = async (request: ResetRequest) => {
    setProcessingId(request.id);
    try {
      const res = await fetch(`/api/platform/reset/${request.id}/dry-run`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Dry run failed');
      toast({ title: 'Dry run complete', description: `${json.data.dryRunSummary.total} rows are in the reset plan. No live data was changed.`, variant: 'success' });
      await load();
      const refreshed = await fetch(`/api/platform/reset/${request.id}`, { cache: 'no-store' }).then((response) => response.json());
      if (refreshed.data?.request) setSelected(refreshed.data.request as ResetRequest);
    } catch (error) {
      toast({ title: 'Dry run failed', description: error instanceof Error ? error.message : 'Dry run failed', variant: 'error' });
    } finally { setProcessingId(null); }
  };

  const createRecoveryPoint = async (request: ResetRequest) => {
    setProcessingId(request.id);
    try {
      const res = await fetch(`/api/platform/reset/${request.id}/backup`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Recovery point creation failed');
      toast({ title: 'Recovery point verified', description: `${json.data.recordCount} records archived to durable storage.`, variant: 'success' });
      await load();
      const refreshed = await fetch(`/api/platform/reset/${request.id}`, { cache: 'no-store' }).then((response) => response.json());
      if (refreshed.data?.request) setSelected(refreshed.data.request as ResetRequest);
    } catch (error) {
      toast({ title: 'Recovery point not ready', description: error instanceof Error ? error.message : 'Backup failed', variant: 'error' });
    } finally { setProcessingId(null); }
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
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmationPhrase: phrase }),
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error || 'Reset execution failed');
          toast({ title: 'Operational reset complete', description: `${json.data.totalRemoved} operational rows were removed. The tenant and its master data were preserved.`, variant: 'success' });
          await load();
        } catch (error) {
          toast({ title: 'Reset blocked or failed', description: error instanceof Error ? error.message : 'Execution failed', variant: 'error' });
        } finally { setProcessingId(null); }
      },
    });
  };

  const selectedTenant = useMemo(() => tenants.find((tenant) => tenant.id === createTenantId), [createTenantId, tenants]);
  const preview = selected?.validationResults ?? null;
  const canExecute = Boolean(selected?.status === 'approved' && selected?.scope === 'operational' && preview?.fingerprint && selected?.backupCreated && selected?.rollbackPossible);
  const legacyUnsupported = Boolean(selected && selected.scope !== 'operational');

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Reset & Cleanup' }]} />
      <PageHeader title="Reset & Cleanup" description="Return a tenant to a clean operational starting point without deleting its organisation, users, staff, roles, vehicles or configuration.">
        <div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => setCreateOpen(true)}><Plus className="h-4 w-4" /> New operational reset</Button><Button variant="secondary" size="sm" asChild><Link href="/dashboard/platform/backups"><ArchiveRestore className="h-4 w-4" /> Backup & Restore</Link></Button></div>
      </PageHeader>

      <section className="rounded-[10px] border border-status-warning-text/20 bg-status-warning-bg/20 p-4"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 text-status-warning-text" /><div><p className="text-sm font-semibold text-ink-950">Reset never deletes the tenant</p><p className="mt-1 text-xs leading-relaxed text-ink-600">The production-safe operational preset clears requests, workflows, allocations, trips, logs, fuel, inspections, operational documents, defects and related notifications. Tenant deletion remains a completely separate action in Tenant Management.</p></div></div></section>

      <section aria-label="Reset summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{[
        ['Total', stats.total, 'text-ink-950'], ['Draft', stats.draft, 'text-ink-700'], ['Pending', stats.pendingReview, 'text-status-warning-text'], ['Approved', stats.approved, 'text-status-info-text'], ['Completed', stats.completed, 'text-status-success-text'], ['Failed', stats.failed, 'text-status-error-text'],
      ].map(([label, value, tone]) => <div key={String(label)} className="rounded-[10px] border border-border bg-surface p-4"><p className={`text-2xl font-semibold tabular-nums ${tone}`}>{Number(value)}</p><p className="mt-1 text-xs text-ink-500">{String(label)}</p></div>)}</section>

      <section className="grid gap-3 border-y border-border py-4 sm:grid-cols-[minmax(0,1fr)_200px_auto]"><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search tenant, code or reason…" /></div><StyledSelect value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option>{Object.entries(STATUS_CONFIG).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}</StyledSelect><Button variant="secondary" size="sm" onClick={() => void load()} loading={loading}><RefreshCw className="h-4 w-4" /> Refresh</Button></section>

      {loading ? <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-ink-500"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> Loading reset requests…</div> : requests.length === 0 ? <EmptyState icon={<Database className="h-6 w-6" />} title="No reset requests" description="Create an operational reset when a tenant needs a clean operational starting point." action={{ label: 'New operational reset', onClick: () => setCreateOpen(true) }} /> : <div className="overflow-hidden rounded-[10px] border border-border bg-surface">{requests.map((request) => { const config = STATUS_CONFIG[request.status] ?? { label: request.status, variant: 'default' as const }; return <article key={request.id} className="grid gap-4 border-b border-border px-4 py-4 last:border-b-0 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-semibold text-ink-950">{request.tenantName || request.tenantId}</p><Badge variant={config.variant} size="sm">{config.label}</Badge><Badge variant={request.scope === 'operational' ? 'info' : 'warning'} size="sm">{request.scope.replace(/_/g, ' ')}</Badge>{request.backupCreated && <Badge variant="success" size="sm">recovery point ready</Badge>}</div><p className="mt-1 line-clamp-2 text-sm text-ink-600">{request.reason}</p><p className="mt-2 text-xs text-ink-400">Created {formatDate(request.createdAt)}{request.validationResults?.dryRunSummary ? ` · dry run ${request.validationResults.dryRunSummary.total} rows` : ''}{request.rollbackPerformed ? ' · restored from recovery point' : ''}</p></div><div className="flex flex-wrap gap-2 lg:justify-end"><Button variant="secondary" size="sm" onClick={() => void openDetails(request)}><Eye className="h-4 w-4" /> Details</Button>{request.status === 'draft' && <Button size="sm" onClick={() => void patchRequest(request, 'submit')} loading={processingId === request.id}>Submit</Button>}</div></article>; })}</div>}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="sm:max-w-xl"><DialogHeader><DialogTitle>Start tenant operational reset</DialogTitle><DialogDescription>This creates a controlled reset request. Nothing is deleted until review, dry run, durable recovery-point verification and typed final confirmation are complete.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-1.5"><Label>Tenant</Label><StyledSelect value={createTenantId} onChange={(event) => setCreateTenantId(event.target.value)}>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.code})</option>)}</StyledSelect></div><div className="rounded-[8px] border border-brand-200 bg-brand-50/40 p-3 dark:bg-brand-950/20"><p className="text-sm font-semibold text-ink-950">Preset: Start operational data from scratch</p><p className="mt-1 text-xs leading-relaxed text-ink-600">Removes transport operations and their generated history. Preserves tenant, branding, staff, users, roles, departments/offices, vehicles, programmes, workflow definitions and audit history.</p></div><div className="space-y-1.5"><Label>Reason</Label><Textarea rows={3} value={createReason} onChange={(event) => setCreateReason(event.target.value)} /></div>{selectedTenant && <p className="text-xs text-ink-500">Final execution confirmation will require: <strong>RESET {selectedTenant.code}</strong></p>}</div><DialogFooter><Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={() => void createReset()} loading={processingId === 'create'} disabled={!createTenantId || !createReason.trim()}><Database className="h-4 w-4" /> Create reset request</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={detailOpen} onOpenChange={(open) => { if (!processingId) { setDetailOpen(open); if (!open) setSelected(null); } }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">{selected && <><DialogHeader><div className="flex flex-wrap items-center gap-2"><DialogTitle>{selected.tenantName || 'Tenant'} reset</DialogTitle><Badge variant={STATUS_CONFIG[selected.status]?.variant}>{STATUS_CONFIG[selected.status]?.label || selected.status}</Badge></div><DialogDescription>{selected.reason}</DialogDescription></DialogHeader><div className="space-y-5">
        {legacyUnsupported && <div className="rounded-[8px] border border-status-warning-text/20 bg-status-warning-bg/20 p-3"><div className="flex gap-2"><TriangleAlert className="mt-0.5 h-4 w-4 text-status-warning-text" /><p className="text-sm text-ink-700">This is a legacy <strong>{selected.scope.replace(/_/g, ' ')}</strong> request. Production execution is disabled. Create a new operational reset request instead.</p></div></div>}

        <section className="grid gap-3 sm:grid-cols-3"><div className="rounded-[8px] border border-border p-3"><p className="text-xs text-ink-500">Tenant code</p><p className="mt-1 text-sm font-semibold text-ink-950">{selected.tenantCode || '—'}</p></div><div className="rounded-[8px] border border-border p-3"><p className="text-xs text-ink-500">Dry run</p><p className="mt-1 text-sm font-semibold text-ink-950">{preview ? `${preview.dryRunSummary.total} rows` : 'Not run'}</p></div><div className="rounded-[8px] border border-border p-3"><p className="text-xs text-ink-500">Recovery point</p><p className={`mt-1 text-sm font-semibold ${selected.backupCreated ? 'text-status-success-text' : 'text-ink-950'}`}>{selected.backupCreated ? 'Verified' : 'Required'}</p></div></section>

        {preview && <section className="space-y-3"><div><h3 className="text-sm font-semibold text-ink-950">Dry-run impact</h3><p className="text-xs text-ink-500">Snapshot calculated {formatDate(preview.plannedAt)}. If operational data changes, execution is blocked until you rerun this step.</p></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-5">{Object.entries(preview.dryRunSummary).map(([label, value]) => <div key={label} className="rounded-[8px] border border-border p-3"><p className="text-xs capitalize text-ink-500">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums text-ink-950">{value}</p></div>)}</div><div className="overflow-hidden rounded-[8px] border border-border">{preview.steps.filter((step) => step.planned > 0).map((step) => <div key={step.table} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2.5 last:border-b-0"><span className="text-sm text-ink-700">{step.label}</span><span className="text-sm font-semibold tabular-nums text-ink-950">{step.planned}</span></div>)}</div></section>}

        {preview && <section className="rounded-[8px] border border-status-success-text/20 bg-status-success-bg/15 p-4"><h3 className="text-sm font-semibold text-ink-950">Protected master data</h3><p className="mt-1 text-xs text-ink-500">These records are explicitly outside the operational reset.</p><div className="mt-3 flex flex-wrap gap-2">{['Tenant & branding','Staff & users','Roles & permissions','Departments & offices','Vehicles','Programmes','Workflow configuration','Audit history'].map((label) => <Badge key={label} variant="success" size="sm">{label}</Badge>)}</div></section>}

        {selected.backupCreated && <section className="rounded-[8px] border border-brand-200 bg-brand-50/40 p-4 dark:bg-brand-950/20"><div className="flex items-start gap-3"><HardDriveDownload className="mt-0.5 h-5 w-5 text-brand-700 dark:text-brand-300" /><div><p className="text-sm font-semibold text-ink-950">Durable recovery point ready</p><p className="mt-1 text-xs text-ink-600">{selected.backupRecordCount ?? 0} records · {formatBytes(selected.backupSizeBytes)}. The archive is retained outside Postgres and can be managed from Backup & Restore.</p></div></div></section>}

        {steps.length > 0 && <section><h3 className="mb-2 text-sm font-semibold text-ink-950">Execution history</h3><div className="overflow-hidden rounded-[8px] border border-border">{steps.map((step, index) => <div key={`${step.tableName}-${index}`} className="grid gap-1 border-b border-border px-3 py-2.5 last:border-b-0 sm:grid-cols-[1fr_130px_auto]"><span className="text-sm text-ink-700">{step.stepName}</span><span className="font-mono text-xs text-ink-400">{step.tableName}</span><span className="text-xs text-ink-500">{step.recordsDeleted} removed</span></div>)}</div></section>}

        {selected.status === 'pending_review' && <section className="space-y-3"><div className="space-y-1.5"><Label>Review notes</Label><Textarea rows={3} value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} /></div><div className="space-y-1.5"><Label>Rejection reason</Label><Input value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Required only when rejecting" /></div></section>}
        {selected.failureReason && <div className="rounded-[8px] bg-status-error-bg p-3 text-status-error-text"><p className="text-sm font-semibold">Previous failure</p><p className="mt-1 text-xs">{selected.failureReason}</p></div>}
      </div><DialogFooter className="flex flex-wrap gap-2 sm:gap-2"><Button variant="secondary" onClick={() => setDetailOpen(false)}>Close</Button>{selected.status === 'draft' && <Button onClick={() => void patchRequest(selected, 'submit')} loading={processingId === selected.id}>Submit for review</Button>}{selected.status === 'pending_review' && <><Button variant="secondary" className="text-status-error-text" onClick={() => void patchRequest(selected, 'reject')} disabled={!rejectionReason.trim()} loading={processingId === selected.id}><XCircle className="h-4 w-4" /> Reject</Button><Button onClick={() => void patchRequest(selected, 'approve')} loading={processingId === selected.id}><CheckCircle2 className="h-4 w-4" /> Approve</Button></>}{selected.status === 'approved' && !legacyUnsupported && <><Button variant="secondary" onClick={() => void runDryRun(selected)} loading={processingId === selected.id}><Eye className="h-4 w-4" /> {preview ? 'Rerun dry run' : 'Run dry run'}</Button>{preview && !selected.backupCreated && <Button variant="secondary" onClick={() => void createRecoveryPoint(selected)} loading={processingId === selected.id}><HardDriveDownload className="h-4 w-4" /> Create recovery point</Button>}{canExecute && <Button variant="destructive" onClick={() => requestExecution(selected)} disabled={Boolean(processingId)}><Trash2 className="h-4 w-4" /> Execute reset</Button>}</>}</DialogFooter></>}</DialogContent></Dialog>

      {confirmDialog}
    </div>
  );
}
