'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Building2,
  CalendarClock,
  Car,
  CheckCircle2,
  Copy,
  ExternalLink,
  Mail,
  MonitorPlay,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
  Users,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StyledDateInput, StyledSelect } from '@/components/ui/styled-select';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/lib/use-toast';

interface DemoSandboxSummary {
  id: string;
  tenantId: string;
  status: string;
  expiresAt: string;
  adminEmail: string;
}

interface DemoRequest {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string;
  jobTitle: string;
  role: string;
  industry: string | null;
  userCount: number | null;
  vehicleCount: number | null;
  monthlyCost: number | null;
  technicalRequirements: string | null;
  integrationNeeds: string | null;
  preferredDate: string | null;
  preferredTime: string | null;
  timezone: string | null;
  contactMethod: string;
  notes: string | null;
  status: string;
  qualifiedAt: string | null;
  scheduledDemoAt: string | null;
  scheduledDemoLink: string | null;
  lastContactAt: string | null;
  nextContactAt: string | null;
  contactNotes: string | null;
  source: string | null;
  sourceDetails: string | null;
  createdAt: string;
  sandbox?: DemoSandboxSummary | null;
}

interface PackageOption { id: string; name: string; code: string; }
interface SandboxCredentials { username: string; email: string; temporaryPassword: string; loginUrl: string; expiresAt: string; }
type BadgeVariant = NonNullable<BadgeProps['variant']>;

const STATUS_CONFIG: Record<string, { label: string; variant: BadgeVariant }> = {
  new: { label: 'New', variant: 'info' },
  qualified: { label: 'Qualified', variant: 'warning' },
  scheduled: { label: 'Scheduled', variant: 'success' },
  completed: { label: 'Completed', variant: 'default' },
  converted: { label: 'Converted', variant: 'success' },
  cancelled: { label: 'Cancelled', variant: 'error' },
};

const STATUS_OPTIONS = [
  ['all', 'All statuses'], ['new', 'New'], ['qualified', 'Qualified'], ['scheduled', 'Scheduled'],
  ['completed', 'Completed'], ['converted', 'Converted'], ['cancelled', 'Cancelled'],
] as const;

const STAT_ITEMS = [
  ['total', 'Total'], ['new', 'New'], ['qualified', 'Qualified'], ['scheduled', 'Scheduled'],
  ['completed', 'Completed'], ['converted', 'Converted'],
] as const;

function displayDate(value: string | null, withTime = false) {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-NA', withTime
    ? { dateStyle: 'medium', timeStyle: 'short' }
    : { dateStyle: 'medium' });
}

function toLocalDateTime(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default function PlatformDemoRequestsPage() {
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [requests, setRequests] = useState<DemoRequest[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [selected, setSelected] = useState<DemoRequest | null>(null);
  const [saving, setSaving] = useState(false);
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduleLink, setScheduleLink] = useState('');
  const [contactNotes, setContactNotes] = useState('');
  const [nextContactAt, setNextContactAt] = useState('');
  const [sandboxOpen, setSandboxOpen] = useState(false);
  const [sandboxPackageId, setSandboxPackageId] = useState('');
  const [sandboxDays, setSandboxDays] = useState('7');
  const [sandboxCreating, setSandboxCreating] = useState(false);
  const [credentials, setCredentials] = useState<SandboxCredentials | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (status !== 'all') params.set('status', status);
      const res = await fetch(`/api/platform/demo-requests?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load demo requests');
      const rows = (json.data?.requests ?? []) as DemoRequest[];
      setRequests(rows);
      setStats(json.data?.stats ?? null);
      const requestId = new URLSearchParams(window.location.search).get('request');
      if (requestId) {
        const target = rows.find((row) => row.id === requestId);
        if (target) openDetails(target);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load demo requests');
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch, status]);

  useEffect(() => { void loadRequests(); }, [loadRequests]);

  useEffect(() => {
    void fetch('/api/platform/onboard')
      .then((res) => res.json())
      .then((json) => {
        const rows = (json.data?.packages ?? []) as PackageOption[];
        setPackages(rows);
        if (rows[0]?.id) setSandboxPackageId((current) => current || rows[0].id);
      })
      .catch(() => {});
  }, []);

  const openDetails = (request: DemoRequest) => {
    setSelected(request);
    setScheduleAt(toLocalDateTime(request.scheduledDemoAt));
    setScheduleLink(request.scheduledDemoLink ?? '');
    setContactNotes(request.contactNotes ?? '');
    setNextContactAt(toLocalDateTime(request.nextContactAt));
  };

  const updateRequest = async (patch: Record<string, unknown>, successMessage: string) => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch('/api/platform/demo-requests', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, ...patch }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to update demo request');
      setSelected({ ...selected, ...json.data } as DemoRequest);
      toast({ title: successMessage, variant: 'success' });
      await loadRequests();
    } catch (err) {
      toast({ title: 'Demo request update failed', description: err instanceof Error ? err.message : 'Update failed', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const saveSchedule = async () => {
    if (!scheduleAt) {
      toast({ title: 'Choose a demo date and time', variant: 'error' });
      return;
    }
    await updateRequest({ status: 'scheduled', scheduledDemoAt: new Date(scheduleAt).toISOString(), scheduledDemoLink: scheduleLink, contactNotes, nextContactAt: nextContactAt ? new Date(nextContactAt).toISOString() : null, lastContactAt: new Date().toISOString() }, 'Demo scheduled');
  };

  const createSandbox = async () => {
    if (!selected || !sandboxPackageId) return;
    setSandboxCreating(true);
    try {
      const res = await fetch('/api/platform/demo-requests/sandbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoRequestId: selected.id, packageId: sandboxPackageId, expiresInDays: Number(sandboxDays) }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sandbox creation failed');
      setCredentials(json.data.credentials as SandboxCredentials);
      setSandboxOpen(false);
      toast({ title: 'Walkthrough sandbox created', description: 'Temporary login credentials are ready to share.', variant: 'success' });
      await loadRequests();
      const refreshed = await fetch(`/api/platform/demo-requests?id=${selected.id}`).then((response) => response.json());
      if (refreshed?.data?.request) setSelected({ ...refreshed.data.request, sandbox: refreshed.data.sandbox });
    } catch (err) {
      toast({ title: 'Sandbox creation failed', description: err instanceof Error ? err.message : 'Could not create sandbox', variant: 'error' });
    } finally {
      setSandboxCreating(false);
    }
  };

  const changeSandboxStatus = async (action: 'revoke' | 'delete') => {
    if (!selected?.sandbox) return;
    setSaving(true);
    try {
      const res = await fetch('/api/platform/demo-requests/sandbox', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ demoRequestId: selected.id, action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Sandbox could not be updated');
      const nextStatus = action === 'delete' ? 'deleted' : 'revoked';
      toast({ title: action === 'delete' ? 'Sandbox removed' : 'Sandbox revoked', description: action === 'delete' ? 'The disposable sandbox tenant has been archived and its audit tombstone retained.' : undefined, variant: 'success' });
      await loadRequests();
      setSelected((current) => current ? { ...current, sandbox: { ...current.sandbox!, status: nextStatus } } : current);
    } catch (err) {
      toast({ title: 'Could not update sandbox', description: err instanceof Error ? err.message : 'Update failed', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const requestSandboxDelete = () => {
    if (!selected?.sandbox || selected.sandbox.status === 'converted') return;
    confirm({
      title: `Remove ${selected.company} walkthrough sandbox?`,
      description: 'This disables the sandbox and archives its disposable tenant. The sandbox tombstone is retained for traceability. Converted sandboxes cannot be removed.',
      confirmLabel: 'Remove sandbox',
      variant: 'destructive',
      onConfirm: async () => { await changeSandboxStatus('delete'); },
    });
  };

  const copyCredentials = async () => {
    if (!credentials) return;
    const text = `GovFleet walkthrough sandbox\nUsername: ${credentials.username}\nEmail: ${credentials.email}\nTemporary password: ${credentials.temporaryPassword}\nLogin: ${credentials.loginUrl}\nExpires: ${displayDate(credentials.expiresAt, true)}`;
    await navigator.clipboard.writeText(text);
    toast({ title: 'Sandbox credentials copied', variant: 'success' });
  };

  const selectedConfig = selected ? STATUS_CONFIG[selected.status] ?? { label: selected.status, variant: 'default' as BadgeVariant } : null;
  const canSandbox = selected && ['qualified', 'scheduled', 'completed'].includes(selected.status) && (!selected.sandbox || selected.sandbox.status === 'deleted');

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Demo Requests' }]} />
      <PageHeader title="Demo Requests" description="Qualify prospects, schedule walkthroughs, create isolated sandboxes and hand successful evaluations into tenant onboarding." />

      {stats && <section aria-label="Demo request summary" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{STAT_ITEMS.map(([key, label], index) => <div key={key} className={`rounded-[10px] border bg-surface px-4 py-4 ${index === 1 ? 'border-brand-200' : index === 2 ? 'border-status-warning-text/20' : index === 3 ? 'border-status-success-text/20' : 'border-border'}`}><p className="text-2xl font-semibold tabular-nums text-ink-950">{stats[key] ?? 0}</p><p className="mt-0.5 text-xs text-ink-500">{label}</p></div>)}</section>}

      <section className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto]" aria-label="Demo request filters">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" /><Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search name, email or organisation…" aria-label="Search demo requests" /></div>
        <Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="Filter demo requests"><SelectValue /></SelectTrigger><SelectContent>{STATUS_OPTIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
        <Button variant="secondary" size="icon" onClick={() => void loadRequests()} loading={loading} aria-label="Refresh demo requests"><RefreshCw className="h-4 w-4" /></Button>
      </section>

      {loading ? <div className="flex min-h-48 items-center justify-center text-sm text-ink-500">Loading demo requests…</div>
        : error ? <EmptyState icon={<MonitorPlay className="h-6 w-6" />} title="Could not load demo requests" description={error} action={{ label: 'Retry', onClick: loadRequests }} />
        : requests.length === 0 ? <EmptyState icon={<MonitorPlay className="h-6 w-6" />} title="No demo requests found" description="New public demo submissions will appear here." />
        : <div className="overflow-hidden rounded-[10px] border border-border bg-surface">{requests.map((request) => { const config = STATUS_CONFIG[request.status] ?? { label: request.status, variant: 'default' as BadgeVariant }; return <button key={request.id} type="button" onClick={() => openDetails(request)} className="focus-ring block w-full border-b border-border px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/40 sm:px-5 motion-reduce:transition-none"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><Building2 className="h-4 w-4 text-ink-400" /><p className="truncate text-sm font-semibold text-ink-950">{request.company}</p><Badge variant={config.variant} size="sm">{config.label}</Badge>{request.sandbox && <Badge variant={request.sandbox.status === 'active' ? 'success' : 'default'} size="sm">sandbox {request.sandbox.status}</Badge>}</div><p className="mt-1 truncate text-xs text-ink-500">{request.name} · {request.jobTitle} · {request.email}</p></div><div className="flex shrink-0 items-center gap-3 text-xs text-ink-500">{request.vehicleCount ? <span className="flex items-center gap-1"><Car className="h-3.5 w-3.5" />{request.vehicleCount} vehicles</span> : null}<span>{displayDate(request.createdAt)}</span><ArrowRight className="h-4 w-4 text-ink-300" /></div></div></button>; })}</div>}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-3xl">{selected && selectedConfig && <><DialogHeader><div className="flex flex-wrap items-center gap-2"><DialogTitle>{selected.company}</DialogTitle><Badge variant={selectedConfig.variant} size="sm">{selectedConfig.label}</Badge></div><DialogDescription>Demo request from {selected.name} · received {displayDate(selected.createdAt)}</DialogDescription></DialogHeader><div className="space-y-5">
          <section className="grid gap-3 rounded-[8px] border border-border bg-muted/25 p-4 sm:grid-cols-2 lg:grid-cols-3"><div><p className="text-xs font-medium text-ink-400">Contact</p><p className="mt-1 text-sm font-semibold text-ink-950">{selected.name}</p><p className="text-xs text-ink-500">{selected.jobTitle}</p><a href={`mailto:${selected.email}`} className="mt-1 flex items-center gap-1 text-xs text-brand-700 hover:underline"><Mail className="h-3.5 w-3.5" />{selected.email}</a>{selected.phone && <a href={`tel:${selected.phone}`} className="mt-1 flex items-center gap-1 text-xs text-brand-700 hover:underline"><Phone className="h-3.5 w-3.5" />{selected.phone}</a>}</div><div><p className="text-xs font-medium text-ink-400">Organisation</p><p className="mt-1 text-sm text-ink-800">{selected.industry || 'Type not specified'}</p><p className="mt-1 flex items-center gap-1 text-xs text-ink-500"><Users className="h-3.5 w-3.5" />{selected.userCount ?? '—'} expected users</p><p className="mt-1 flex items-center gap-1 text-xs text-ink-500"><Car className="h-3.5 w-3.5" />{selected.vehicleCount ?? '—'} vehicles</p></div><div><p className="text-xs font-medium text-ink-400">Preference</p><p className="mt-1 text-sm text-ink-800">{displayDate(selected.preferredDate)}</p><p className="text-xs text-ink-500">{selected.preferredTime || 'Flexible time'} · {selected.contactMethod}</p><p className="mt-1 text-xs text-ink-500">Source: {selected.source || 'website'}</p></div></section>

          {(selected.notes || selected.technicalRequirements || selected.integrationNeeds) && <section className="space-y-3"><h3 className="text-sm font-semibold text-ink-950">Evaluation context</h3>{selected.notes && <div><p className="text-xs font-medium text-ink-400">Notes</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{selected.notes}</p></div>}{selected.technicalRequirements && <div><p className="text-xs font-medium text-ink-400">Technical requirements</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{selected.technicalRequirements}</p></div>}{selected.integrationNeeds && <div><p className="text-xs font-medium text-ink-400">Integration needs</p><p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{selected.integrationNeeds}</p></div>}</section>}

          {selected.status === 'new' && <div className="flex items-center justify-between gap-4 rounded-[8px] border border-brand-200 bg-brand-50/40 p-4 dark:bg-brand-950/10"><div><p className="text-sm font-semibold text-ink-950">Qualification</p><p className="mt-1 text-xs text-ink-500">Confirm this is a legitimate evaluation before scheduling or provisioning a sandbox.</p></div><Button size="sm" onClick={() => void updateRequest({ status: 'qualified' }, 'Demo request qualified')} loading={saving}><UserRoundCheck className="h-4 w-4" /> Qualify</Button></div>}

          {['qualified', 'scheduled', 'completed'].includes(selected.status) && <section className="space-y-3"><div><h3 className="text-sm font-semibold text-ink-950">Walkthrough & follow-up</h3><p className="text-xs text-ink-500">Schedule the session and record internal follow-up notes.</p></div><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-1.5"><Label>Demo date & time</Label><StyledDateInput type="datetime-local" value={scheduleAt} onChange={(event) => setScheduleAt(event.target.value)} /></div><div className="space-y-1.5"><Label>Next follow-up</Label><StyledDateInput type="datetime-local" value={nextContactAt} onChange={(event) => setNextContactAt(event.target.value)} /></div><div className="space-y-1.5 sm:col-span-2"><Label>Meeting link</Label><Input type="url" value={scheduleLink} onChange={(event) => setScheduleLink(event.target.value)} placeholder="https://…" /></div><div className="space-y-1.5 sm:col-span-2"><Label>Internal contact notes</Label><Textarea rows={3} value={contactNotes} onChange={(event) => setContactNotes(event.target.value)} /></div></div><Button variant="secondary" size="sm" onClick={() => void saveSchedule()} loading={saving}><CalendarClock className="h-4 w-4" /> Save schedule</Button></section>}

          {selected.sandbox && selected.sandbox.status !== 'deleted' ? <section className="rounded-[8px] border border-border p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-brand-700" /><h3 className="text-sm font-semibold text-ink-950">Walkthrough sandbox</h3><Badge variant={selected.sandbox.status === 'active' ? 'success' : 'default'} size="sm">{selected.sandbox.status}</Badge></div><p className="mt-1 text-xs text-ink-500">Temporary isolated tenant · expires {displayDate(selected.sandbox.expiresAt, true)}</p><p className="mt-1 text-xs text-ink-500">Login email: {selected.sandbox.adminEmail}</p></div><div className="flex flex-wrap gap-2">{selected.sandbox.status === 'active' && <Button variant="secondary" size="sm" onClick={() => void changeSandboxStatus('revoke')} loading={saving}>Revoke access</Button>}{selected.sandbox.status !== 'converted' && <Button variant="destructive" size="sm" onClick={requestSandboxDelete} loading={saving}><Trash2 className="h-4 w-4" /> Remove sandbox</Button>}</div></div></section>
            : canSandbox ? <section className="flex flex-col gap-3 rounded-[8px] border border-border p-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold text-ink-950">Create walkthrough sandbox</h3><p className="mt-1 text-xs text-ink-500">Provision an isolated, time-limited tenant and temporary Tenant Administrator login for evaluation.</p></div><Button variant="secondary" size="sm" onClick={() => setSandboxOpen(true)}><MonitorPlay className="h-4 w-4" /> Create sandbox</Button></section> : null}

          {selected.status === 'scheduled' && <Button size="sm" onClick={() => void updateRequest({ status: 'completed', lastContactAt: new Date().toISOString(), contactNotes }, 'Demo marked completed')} loading={saving}><CheckCircle2 className="h-4 w-4" /> Mark walkthrough completed</Button>}
          {['qualified', 'scheduled', 'completed'].includes(selected.status) && <section className="flex flex-col gap-3 rounded-[8px] border border-status-success-text/20 bg-status-success-bg/20 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-semibold text-ink-950">Ready to become a tenant?</h3><p className="mt-1 text-xs text-ink-500">Start the real onboarding wizard with this organisation/contact prefilled. The lead is marked converted only after tenant creation succeeds.</p></div><Button asChild size="sm"><Link href={`/dashboard/platform/onboard?demoRequest=${selected.id}`}>Onboard organisation <ArrowRight className="h-4 w-4" /></Link></Button></section>}
          {!['converted', 'cancelled'].includes(selected.status) && <Button variant="ghost" size="sm" className="text-status-error-text" onClick={() => void updateRequest({ status: 'cancelled' }, 'Demo request cancelled')} loading={saving}>Cancel request</Button>}
        </div></>}</DialogContent>
      </Dialog>

      <Dialog open={sandboxOpen} onOpenChange={setSandboxOpen}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>Create walkthrough sandbox</DialogTitle><DialogDescription>Creates a real isolated tenant with a temporary Tenant Administrator login. The sandbox is clearly marked as demo data and expires automatically by policy.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-1.5"><Label>Package</Label><StyledSelect value={sandboxPackageId} onChange={(event) => setSandboxPackageId(event.target.value)}>{packages.map((pkg) => <option key={pkg.id} value={pkg.id}>{pkg.name} ({pkg.code})</option>)}</StyledSelect></div><div className="space-y-1.5"><Label>Access duration</Label><StyledSelect value={sandboxDays} onChange={(event) => setSandboxDays(event.target.value)}><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></StyledSelect></div></div><DialogFooter><Button variant="secondary" onClick={() => setSandboxOpen(false)}>Cancel</Button><Button onClick={() => void createSandbox()} loading={sandboxCreating} disabled={!sandboxPackageId}><MonitorPlay className="h-4 w-4" /> Create sandbox</Button></DialogFooter></DialogContent></Dialog>

      <Dialog open={Boolean(credentials)} onOpenChange={(open) => { if (!open) setCredentials(null); }}><DialogContent className="sm:max-w-lg">{credentials && <><DialogHeader><DialogTitle>Sandbox credentials</DialogTitle><DialogDescription>These temporary credentials are shown once. Copy them now and share them through an appropriate channel.</DialogDescription></DialogHeader><div className="space-y-3 rounded-[8px] border border-border bg-muted/30 p-4 font-mono text-sm"><p><span className="text-ink-500">Username:</span> {credentials.username}</p><p><span className="text-ink-500">Email:</span> {credentials.email}</p><p><span className="text-ink-500">Password:</span> {credentials.temporaryPassword}</p><p className="break-all"><span className="text-ink-500">Login:</span> {credentials.loginUrl}</p><p><span className="text-ink-500">Expires:</span> {displayDate(credentials.expiresAt, true)}</p></div><DialogFooter className="flex flex-wrap gap-2"><Button variant="secondary" onClick={() => void copyCredentials()}><Copy className="h-4 w-4" /> Copy credentials</Button><Button asChild><a href={credentials.loginUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /> Open login</a></Button></DialogFooter></> }</DialogContent></Dialog>

      {confirmDialog}
    </div>
  );
}
