'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronLeft, ChevronRight, Clock, Plus, Search, Users } from 'lucide-react';
import { Breadcrumbs, PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/lib/utils';

interface TenantRow {
  id: string;
  name: string;
  code: string;
  slug: string;
  type: string;
  status: string;
  lifecycleStatus: string | null;
  createdAt: string;
  contactEmail: string | null;
  memberCount: number;
}

const statusOptions = [
  { value: 'all', label: 'All account statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'TRIAL', label: 'Trial' },
  { value: 'ARCHIVED', label: 'Archived' },
];

const lifecycleOptions = [
  { value: 'all', label: 'All lifecycle stages' },
  { value: 'PENDING_INVITATION', label: 'Pending invitation' },
  { value: 'INVITATION_SENT', label: 'Invitation sent' },
  { value: 'SETUP_IN_PROGRESS', label: 'Setup in progress' },
  { value: 'PENDING_PLATFORM_REVIEW', label: 'Pending platform review' },
  { value: 'READY_FOR_ACTIVATION', label: 'Ready for activation' },
  { value: 'ACTIVE', label: 'Active lifecycle' },
  { value: 'SUSPENDED', label: 'Suspended lifecycle' },
  { value: 'ARCHIVED', label: 'Archived lifecycle' },
  { value: 'ONBOARDING_FAILED', label: 'Onboarding failed' },
];

function accountBadge(status: string) {
  const value = status.toUpperCase();
  if (value === 'ACTIVE') return <Badge variant="success" size="sm">Active</Badge>;
  if (value === 'SUSPENDED') return <Badge variant="error" size="sm">Suspended</Badge>;
  if (value === 'TRIAL') return <Badge variant="warning" size="sm">Trial</Badge>;
  return <Badge variant="default" size="sm">{value.charAt(0) + value.slice(1).toLowerCase()}</Badge>;
}

function lifecycleBadge(status: string | null) {
  if (!status) return <span className="text-xs text-ink-400">Not set</span>;
  const variant = status === 'ACTIVE' ? 'success' : status === 'ONBOARDING_FAILED' ? 'error' : status === 'PENDING_PLATFORM_REVIEW' ? 'warning' : 'info';
  return <Badge variant={variant} size="sm">{status.replace(/_/g, ' ').toLowerCase()}</Badge>;
}

export default function PlatformTenantsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [lifecycle, setLifecycle] = useState('all');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const query = useQuery({
    queryKey: ['platform-tenants', debouncedSearch, status, lifecycle, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: '25' });
      if (debouncedSearch) params.set('q', debouncedSearch);
      if (status !== 'all') params.set('status', status);
      if (lifecycle !== 'all') params.set('lifecycle', lifecycle);
      const res = await fetch(`/api/platform/tenants?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load tenants');
      return json.data as { tenants: TenantRow[]; total: number; totalPages: number };
    },
    staleTime: 10_000,
  });

  const tenants = query.data?.tenants ?? [];
  const total = query.data?.total ?? 0;
  const totalPages = query.data?.totalPages ?? 1;
  const filtered = Boolean(search || status !== 'all' || lifecycle !== 'all');

  const clearFilters = () => {
    setSearch('');
    setStatus('all');
    setLifecycle('all');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[{ label: 'Platform', href: '/dashboard/platform' }, { label: 'Tenant Management' }]} />
      <PageHeader title="Tenant Management" description={`${total} tenant${total === 1 ? '' : 's'} on the platform`}>
        <Button size="sm" asChild><Link href="/dashboard/platform/onboard"><Plus className="h-4 w-4" /> Onboard tenant</Link></Button>
      </PageHeader>

      <section className="grid gap-3 md:grid-cols-[minmax(0,1fr)_200px_240px_auto] md:items-center" aria-label="Tenant filters">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" /><Input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} className="pl-9" placeholder="Search tenant name, code or slug…" aria-label="Search tenants" /></div>
        <Select value={status} onValueChange={(value) => { setStatus(value); setPage(1); }}><SelectTrigger aria-label="Account status"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
        <Select value={lifecycle} onValueChange={(value) => { setLifecycle(value); setPage(1); }}><SelectTrigger aria-label="Lifecycle status"><SelectValue /></SelectTrigger><SelectContent>{lifecycleOptions.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
        <ClientFilterReset isFiltered={filtered} onClear={clearFilters} />
      </section>

      {query.isLoading ? <div className="flex min-h-52 items-center justify-center text-sm text-ink-500">Loading tenants…</div>
        : query.error ? <EmptyState icon={<Building2 className="h-6 w-6" />} title="Could not load tenants" description={query.error instanceof Error ? query.error.message : 'Tenant query failed'} action={{ label: 'Retry', onClick: () => query.refetch() }} />
        : tenants.length === 0 ? <EmptyState icon={<Building2 className="h-6 w-6" />} title="No tenants found" description={filtered ? 'No tenant matches the active filters.' : 'Onboard the first organisation to create its isolated workspace.'} action={filtered ? { label: 'Clear filters', onClick: clearFilters } : { label: 'Onboard tenant', href: '/dashboard/platform/onboard' }} />
        : (
          <div className="overflow-hidden rounded-[10px] border border-border bg-surface">
            {tenants.map((tenant) => (
              <Link key={tenant.id} href={`/dashboard/platform/tenants/${tenant.id}`} className="focus-ring group grid gap-3 border-b border-border px-4 py-4 transition-colors last:border-b-0 hover:bg-muted/35 sm:px-5 lg:grid-cols-[minmax(0,1fr)_170px_230px_24px] lg:items-center motion-reduce:transition-none">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] bg-brand-50 text-brand-700"><Building2 className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink-950">{tenant.name}</p><div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500"><span className="font-mono">{tenant.code}</span><span className="capitalize">{tenant.type.replace(/_/g, ' ')}</span><span className="flex items-center gap-1"><Users className="h-3 w-3" />{tenant.memberCount}</span>{tenant.contactEmail && <span className="max-w-xs truncate">{tenant.contactEmail}</span>}</div></div></div>
                </div>
                <div className="lg:border-l lg:border-border lg:pl-4"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Account</p>{accountBadge(tenant.status)}</div>
                <div className="lg:border-l lg:border-border lg:pl-4"><p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-400">Onboarding / lifecycle</p><div className="flex flex-wrap items-center gap-2">{lifecycleBadge(tenant.lifecycleStatus)}<span className="flex items-center gap-1 text-[11px] text-ink-400"><Clock className="h-3 w-3" />{formatDate(tenant.createdAt)}</span></div></div>
                <ChevronRight className="hidden h-4 w-4 text-ink-300 lg:block" />
              </Link>
            ))}
          </div>
        )}

      {totalPages > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4"><p className="text-xs text-ink-500">Page {page} of {totalPages} · {total} tenants</p><div className="flex gap-2"><Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft className="h-4 w-4" /> Previous</Button><Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight className="h-4 w-4" /></Button></div></div>}
    </div>
  );
}
