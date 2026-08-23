'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PageHeader, Breadcrumbs } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { ClientFilterReset } from '@/components/ui/client-filter-reset';
import { FilterTabs } from '@/components/ui/filter-tabs';
import { TruncatedText } from '@/components/ui/long-value';
import {
  ArrowRight,
  CalendarDays,
  Gauge,
  Loader2,
  MapPin,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import Link from 'next/link';

interface Programme {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  purpose: string | null;
  department: string | null;
  status: string;
  venue: string | null;
  region: string | null;
  startDate: string | null;
  endDate: string | null;
  expectedParticipants: number | null;
  estimatedKilometres: number | null;
  ownerName: string | null;
  departmentName: string | null;
  officeName: string | null;
  regionName: string | null;
  createdAt: string;
}

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'submitted', label: 'Submitted' },
  { value: 'changes_requested', label: 'Changes Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'archived', label: 'Archived' },
  { value: 'completed', label: 'Completed' },
];

const STATUS_VARIANT: Record<string, 'success' | 'pending' | 'info' | 'error' | 'cancelled'> = {
  draft: 'pending',
  submitted: 'info',
  changes_requested: 'pending',
  approved: 'success',
  published: 'success',
  rejected: 'error',
  archived: 'cancelled',
  completed: 'success',
};

function formatDateShort(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-NA', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export default function ProgrammesPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = searchInput.trim();
      setSearch((current) => {
        if (current === next) return current;
        setPage(1);
        return next;
      });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['programmes', search, status, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set('q', search);
      if (status) params.set('status', status);
      params.set('page', String(page));
      params.set('limit', '25');

      const response = await fetch(`/api/programmes?${params}`);
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Failed to load programmes');
      return json;
    },
  });

  const programmes: Programme[] = data?.data || [];
  const total: number = data?.total || 0;
  const totalPages: number = data?.totalPages || 1;
  const isFiltered = Boolean(searchInput.trim() || status);

  return (
    <div className="space-y-5 sm:space-y-6">
      <Breadcrumbs items={[{ label: 'Dashboard', href: '/dashboard' }, { label: 'Programmes' }]} />
      <PageHeader
        title="Programmes"
        description={`${total} programme${total !== 1 ? 's' : ''} · reusable activities linked to transport requests`}
      >
        <Button variant="primary" size="sm" asChild className="w-full sm:w-auto">
          <Link href="/dashboard/programmes/new">
            <Plus className="h-4 w-4" /> New Programme
          </Link>
        </Button>
      </PageHeader>

      <section aria-label="Programme filters" className="border-border space-y-3 border-y py-4">
        <FilterTabs
          items={STATUS_TABS}
          value={status}
          onValueChange={(nextStatus) => {
            setStatus(nextStatus);
            setPage(1);
          }}
          label="Programme status"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1 sm:max-w-md">
            <Search
              className="text-ink-400 pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Search programmes"
              placeholder="Search title, reference, venue or department…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="pl-9"
            />
          </div>
          <ClientFilterReset
            isFiltered={isFiltered}
            onClear={() => {
              setSearchInput('');
              setSearch('');
              setStatus('');
              setPage(1);
            }}
          />
        </div>
      </section>

      {error && (
        <div
          className="border-status-error-border bg-status-error-bg text-status-error-text flex flex-col gap-3 rounded-[8px] border px-4 py-3 sm:flex-row sm:items-center"
          role="alert"
        >
          <p className="min-w-0 flex-1 text-sm">
            {error instanceof Error ? error.message : 'Failed to load programmes'}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refetch()}
            className="w-full sm:w-auto"
          >
            Retry
          </Button>
        </div>
      )}

      {isLoading && (
        <div
          className="text-ink-500 flex items-center justify-center gap-2 py-14 text-sm"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          Loading programmes…
        </div>
      )}

      {!isLoading && !error && programmes.length === 0 && (
        <EmptyState
          icon={<CalendarDays className="h-6 w-6" />}
          title={isFiltered ? 'No programmes match your filters' : 'No programmes yet'}
          description={
            isFiltered
              ? 'No matching records were found. Clear the filters to view the full programme register.'
              : 'Create a programme, submit it for review and publish it so requesters can link it to transport requests.'
          }
          action={
            isFiltered ? undefined : { label: 'New Programme', href: '/dashboard/programmes/new' }
          }
        />
      )}

      {!isLoading && programmes.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {programmes.map((programme) => (
            <Link
              key={programme.id}
              href={`/dashboard/programmes/${programme.id}`}
              className="focus-ring border-border bg-surface hover:border-brand-200 group flex min-w-0 flex-col rounded-[10px] border p-4 transition-[border-color,background-color,box-shadow] hover:shadow-sm motion-reduce:transition-none sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-ink-950 group-hover:text-brand-700 text-sm font-semibold transition-colors motion-reduce:transition-none">
                    <TruncatedText value={programme.title} lines={2} />
                  </h2>
                  <p className="text-ink-500 mt-1 font-mono text-[11px] break-all">
                    {programme.reference}
                  </p>
                </div>
                <Badge
                  variant={STATUS_VARIANT[programme.status] ?? 'info'}
                  size="sm"
                  className="shrink-0 capitalize"
                >
                  {programme.status.replace(/_/g, ' ')}
                </Badge>
              </div>

              {programme.description && (
                <TruncatedText
                  value={programme.description}
                  lines={2}
                  className="text-ink-500 mt-3 text-xs leading-5"
                />
              )}

              <div className="text-ink-500 mt-3 grid gap-1.5 text-xs">
                <span className="flex min-w-0 items-start gap-1.5">
                  <CalendarDays
                    className="text-ink-400 mt-0.5 h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {formatDateShort(programme.startDate)}
                    {programme.endDate && programme.endDate !== programme.startDate
                      ? ` – ${formatDateShort(programme.endDate)}`
                      : ''}
                  </span>
                </span>
                {programme.venue && (
                  <span className="flex min-w-0 items-start gap-1.5">
                    <MapPin
                      className="text-ink-400 mt-0.5 h-3.5 w-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 break-words">{programme.venue}</span>
                  </span>
                )}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                  {programme.expectedParticipants != null && (
                    <span className="flex items-center gap-1.5">
                      <Users className="text-ink-400 h-3.5 w-3.5" aria-hidden="true" />
                      {programme.expectedParticipants} participant
                      {programme.expectedParticipants === 1 ? '' : 's'}
                    </span>
                  )}
                  {programme.estimatedKilometres != null && (
                    <span className="flex items-center gap-1.5">
                      <Gauge className="text-ink-400 h-3.5 w-3.5" aria-hidden="true" />
                      {programme.estimatedKilometres.toLocaleString()} km
                    </span>
                  )}
                </div>
              </div>

              <div className="border-border mt-auto flex min-w-0 items-center justify-between gap-3 border-t pt-3 text-xs">
                <TruncatedText
                  value={`${programme.ownerName || 'Owner not recorded'}${programme.departmentName ? ` · ${programme.departmentName}` : ''}`}
                  className="text-ink-500 min-w-0"
                />
                <span className="text-brand-700 flex shrink-0 items-center gap-1 font-medium">
                  Open <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!isLoading && totalPages > 1 && (
        <nav
          aria-label="Programme pagination"
          className="border-border flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-ink-500 text-xs">
            {total} programme{total === 1 ? '' : 's'} · Page {page} of {totalPages}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              className="w-full sm:w-auto"
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((current) => current + 1)}
              className="w-full sm:w-auto"
            >
              Next
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
