'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Mail, MessageSquareText, Phone, RefreshCw, Search, UserCheck } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/lib/use-toast';

interface PublicEnquiry {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  subject: string;
  message: string;
  category: string;
  status: string;
  assignedToUserId: string | null;
  assignedAt: string | null;
  resolvedAt: string | null;
  resolution: string | null;
  source: string;
  createdAt: string;
  updatedAt: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'new', label: 'New' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

function statusBadge(status: string) {
  if (status === 'new') return <Badge variant="info" size="sm">New</Badge>;
  if (status === 'in_progress') return <Badge variant="warning" size="sm">In progress</Badge>;
  if (status === 'resolved') return <Badge variant="success" size="sm">Resolved</Badge>;
  return <Badge variant="default" size="sm">Closed</Badge>;
}

export default function PlatformEnquiriesPage() {
  const { toast } = useToast();
  const searchParams = useSearchParams();
  const requestedId = searchParams.get('enquiry');
  const [enquiries, setEnquiries] = useState<PublicEnquiry[]>([]);
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<PublicEnquiry | null>(null);
  const [resolution, setResolution] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (status !== 'all') params.set('status', status);
      params.set('limit', '100');
      const res = await fetch(`/api/platform/enquiries?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load public enquiries');
      const rows = (json.data?.enquiries ?? []) as PublicEnquiry[];
      setEnquiries(rows);
      setStats(json.data?.stats ?? null);
      if (requestedId) {
        const requested = rows.find((row) => row.id === requestedId);
        if (requested) {
          setSelected(requested);
          setResolution(requested.resolution ?? '');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load public enquiries');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, requestedId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateStatus = async (nextStatus: string) => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await fetch('/api/platform/enquiries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: selected.id, status: nextStatus, resolution }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Could not update enquiry');
      setSelected(json.data);
      setResolution(json.data.resolution ?? '');
      toast({ title: 'Enquiry updated', description: `Marked as ${nextStatus.replace('_', ' ')}.`, variant: 'success' });
      await load();
    } catch (err) {
      toast({ title: 'Update failed', description: err instanceof Error ? err.message : 'Could not update enquiry', variant: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const statItems = useMemo(() => [
    ['total', 'Total'],
    ['new', 'New'],
    ['inProgress', 'In progress'],
    ['resolved', 'Resolved'],
  ] as const, []);

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Public Enquiries' }]} />
      <PageHeader title="Public Enquiries" description="Messages submitted through the public Contact page." />

      {stats && (
        <section aria-label="Public enquiry summary" className="grid overflow-hidden rounded-[10px] border border-border bg-border sm:grid-cols-4">
          {statItems.map(([key, label]) => (
            <div key={key} className="bg-surface px-4 py-4">
              <p className="text-2xl font-semibold tabular-nums text-ink-950">{stats[key] ?? 0}</p>
              <p className="mt-0.5 text-xs text-ink-500">{label}</p>
            </div>
          ))}
        </section>
      )}

      <section aria-label="Public enquiry filters" className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px_auto] sm:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" aria-hidden="true" />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search sender, email, subject or message…" aria-label="Search public enquiries" />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Filter enquiries by status"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="secondary" size="icon" onClick={() => void load()} loading={loading} aria-label="Refresh enquiries">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </Button>
      </section>

      {loading ? (
        <div className="flex min-h-48 items-center justify-center text-sm text-ink-500" role="status">Loading enquiries…</div>
      ) : error ? (
        <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title="Could not load enquiries" description={error} action={{ label: 'Retry', onClick: load }} />
      ) : enquiries.length === 0 ? (
        <EmptyState icon={<MessageSquareText className="h-6 w-6" />} title="No enquiries found" description="New Contact page messages will appear here." />
      ) : (
        <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
          {enquiries.map((enquiry) => (
            <button
              key={enquiry.id}
              type="button"
              onClick={() => { setSelected(enquiry); setResolution(enquiry.resolution ?? ''); }}
              className="focus-ring flex w-full flex-col gap-2 border-b border-border px-4 py-4 text-left transition-colors last:border-b-0 hover:bg-muted/40 sm:px-5 motion-reduce:transition-none"
            >
              <div className="flex w-full flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-950">{enquiry.subject}</p>
                  <p className="mt-0.5 truncate text-xs text-ink-500">{enquiry.name} · {enquiry.email}</p>
                </div>
                {statusBadge(enquiry.status)}
              </div>
              <p className="line-clamp-2 max-w-4xl text-xs leading-relaxed text-ink-500">{enquiry.message}</p>
            </button>
          ))}
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(null); }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>{selected.subject}</DialogTitle>
                  {statusBadge(selected.status)}
                </div>
                <DialogDescription>Submitted through the public Contact page.</DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                <div className="grid gap-3 rounded-[8px] border border-border bg-muted/30 p-4 sm:grid-cols-2">
                  <div>
                    <p className="text-xs font-medium text-ink-400">Contact</p>
                    <p className="mt-1 text-sm font-medium text-ink-950">{selected.name}</p>
                    <a href={`mailto:${selected.email}`} className="mt-1 flex items-center gap-1.5 text-xs text-brand-700 hover:underline"><Mail className="h-3.5 w-3.5" />{selected.email}</a>
                    {selected.phone && <a href={`tel:${selected.phone}`} className="mt-1 flex items-center gap-1.5 text-xs text-brand-700 hover:underline"><Phone className="h-3.5 w-3.5" />{selected.phone}</a>}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-ink-400">Routing</p>
                    <p className="mt-1 text-sm text-ink-700">Category: {selected.category.replace(/_/g, ' ')}</p>
                    <p className="mt-1 text-xs text-ink-500">Source: {selected.source.replace(/_/g, ' ')}</p>
                    {selected.assignedToUserId && <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-500"><UserCheck className="h-3.5 w-3.5" />Assigned</p>}
                  </div>
                </div>

                <div>
                  <Label>Message</Label>
                  <div className="mt-1.5 whitespace-pre-wrap rounded-[8px] border border-border bg-surface p-4 text-sm leading-relaxed text-ink-700">{selected.message}</div>
                </div>

                <div>
                  <Label htmlFor="enquiry-resolution">Internal resolution / response note</Label>
                  <Textarea id="enquiry-resolution" rows={4} value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder="Record what was answered, agreed or handed over…" />
                </div>
              </div>

              <DialogFooter className="mobile-action-bar flex flex-wrap gap-2 sm:justify-end">
                {selected.status === 'new' && <Button variant="secondary" onClick={() => void updateStatus('in_progress')} loading={saving}>Take ownership</Button>}
                {selected.status !== 'resolved' && selected.status !== 'closed' && <Button onClick={() => void updateStatus('resolved')} loading={saving}>Resolve</Button>}
                {selected.status === 'resolved' && <Button variant="secondary" onClick={() => void updateStatus('closed')} loading={saving}>Close</Button>}
                {selected.status !== 'new' && <Button variant="ghost" onClick={() => void updateStatus('new')} disabled={saving}>Return to new</Button>}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
